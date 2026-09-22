#![cfg(feature = "installer-ui")]

use app_lib::installer::jobs::JobManager;
use app_lib::installer::protocol::{
    parse_worker_line, validate_execution, Confirmation, ErrorCode, ExecuteRequest, Execution, Issue, JobState,
    Outcome, WorkerMessage, MAX_LINE_BYTES,
};

fn request(operation_id: &str, plan_id: &str) -> ExecuteRequest {
    ExecuteRequest {
        operation_id: operation_id.into(),
        plan_id: plan_id.into(),
        confirmation: Confirmation::Install,
        allow_conflicts: false,
    }
}

#[test]
fn duplicate_operation_reuses_one_job() {
    let mut jobs = JobManager::default();
    let first = jobs.reserve(request("op-1", "plan-1")).unwrap();
    let second = jobs.reserve(request("op-1", "plan-1")).unwrap();

    assert_eq!(first.operation_id, second.operation_id);
    assert_eq!(jobs.len(), 1);
}

#[test]
fn duplicate_operation_with_different_request_is_rejected() {
    let mut jobs = JobManager::default();
    jobs.reserve(request("op-1", "plan-1")).unwrap();

    let issue = jobs.reserve(request("op-1", "plan-2")).unwrap_err();
    assert_eq!(issue.code, ErrorCode::PlanStale);
    assert_eq!(jobs.len(), 1);
}

#[test]
fn second_operation_is_busy_while_first_is_unresolved() {
    let mut jobs = JobManager::default();
    jobs.reserve(request("op-1", "plan-1")).unwrap();

    let issue = jobs.reserve(request("op-2", "plan-2")).unwrap_err();
    assert_eq!(issue.code, ErrorCode::Busy);
}

#[test]
fn unknown_operation_cannot_be_replayed_and_reconcile_does_not_claim_success() {
    let mut jobs = JobManager::default();
    let original = request("op-1", "plan-1");
    jobs.reserve(original.clone()).unwrap();
    jobs.mark_unknown("op-1", Issue::worker("worker ended without a final reply"));

    let replay = jobs.reserve(original).unwrap();
    assert_eq!(replay.state, JobState::Unknown);
    assert_eq!(jobs.reserve(request("op-2", "plan-2")).unwrap_err().code, ErrorCode::Busy);

    let reconciled = jobs.mark_reconciled("op-1", None).unwrap();
    assert_eq!(reconciled.state, JobState::Reconciled);
    assert!(reconciled.result.is_none());
    assert!(jobs.reserve(request("op-2", "plan-2")).is_ok());
}

#[test]
fn worker_protocol_rejects_unknown_fields_and_oversized_lines() {
    let unknown = br#"{"v":1,"requestId":"r1","type":"reply","ok":true,"data":{},"extra":true}"#;
    assert_eq!(parse_worker_line(unknown).unwrap_err().code, ErrorCode::WorkerUnavailable);

    let oversized = vec![b' '; MAX_LINE_BYTES + 1];
    assert_eq!(parse_worker_line(&oversized).unwrap_err().code, ErrorCode::WorkerUnavailable);
}

#[test]
fn worker_protocol_rejects_progress_beyond_total() {
    let line = br#"{"v":1,"requestId":"r1","type":"progress","operationId":"op-1","data":{"phase":"installing","completed":3,"total":2,"currentFile":"x","batchId":null}}"#;
    assert_eq!(parse_worker_line(line).unwrap_err().code, ErrorCode::WorkerUnavailable);
}

#[test]
fn unknown_operation_keeps_native_reads_blocked_until_reconciled() {
    let mut jobs = JobManager::default();
    jobs.reserve(request("op-1", "plan-1")).unwrap();
    jobs.mark_unknown("op-1", Issue::worker("lost final report"));
    assert!(jobs.has_unresolved());
    jobs.mark_reconciled("op-1", None).unwrap();
    assert!(!jobs.has_unresolved());
}

fn reply_with_issue(issue: &str) -> Vec<u8> {
    format!(r#"{{"v":1,"requestId":"r1","type":"reply","ok":false,"error":{issue}}}"#).into_bytes()
}

#[test]
fn worker_issues_must_carry_english() {
    let missing = reply_with_issue(r#"{"code":"PLAN_MISSING","message":"预览已失效","path":null}"#);
    assert_eq!(parse_worker_line(&missing).unwrap_err().code, ErrorCode::WorkerUnavailable);
    for bad in ["", "   ", "预览已失效", "Preview expired（重新预览）"] {
        let line = reply_with_issue(&format!(
            r#"{{"code":"PLAN_MISSING","message":"预览已失效","messageEn":{},"path":null}}"#,
            serde_json::to_string(bad).unwrap()
        ));
        assert_eq!(parse_worker_line(&line).unwrap_err().code, ErrorCode::WorkerUnavailable, "{bad:?}");
    }
    let good = reply_with_issue(r#"{"code":"PLAN_MISSING","message":"预览已失效","messageEn":"The preview expired.","path":null}"#);
    match parse_worker_line(&good).unwrap() {
        WorkerMessage::Reply { result: Err(issue), .. } => {
            assert_eq!(issue.code, ErrorCode::PlanMissing);
            assert_eq!(issue.message_en, "The preview expired.");
        }
        other => panic!("unexpected {other:?}"),
    }
}

fn execution(errors: &[&str], errors_en: &[&str]) -> Execution {
    Execution {
        status: Outcome::RolledBack, batch_id: Some("b".into()), items: vec![],
        errors: errors.iter().map(|s| s.to_string()).collect(),
        errors_en: errors_en.iter().map(|s| s.to_string()).collect(),
    }
}

#[test]
fn execution_errors_carry_an_english_twin_per_line() {
    assert!(validate_execution(&execution(&[], &[])).is_ok());
    assert!(validate_execution(&execution(&["写入失败"], &["The write failed."])).is_ok());
    assert!(validate_execution(&execution(&["写入失败"], &[])).is_err(), "one twin per line");
    assert!(validate_execution(&execution(&["写入失败"], &["写入失败"])).is_err(), "no CJK in English");
    assert!(validate_execution(&execution(&["写入失败"], &[""])).is_err(), "no empty English");
    let wire: Execution = serde_json::from_str(r#"{"status":"completed","batchId":null,"items":[],"errors":[],"errorsEn":[]}"#).unwrap();
    assert!(wire.errors_en.is_empty());
    assert!(serde_json::from_str::<Execution>(r#"{"status":"completed","batchId":null,"items":[],"errors":[]}"#).is_err());
}

#[test]
fn rust_issues_are_bilingual() {
    let issue = Issue::new(ErrorCode::Busy, "请稍候", "Please wait.");
    let wire = serde_json::to_value(&issue).unwrap();
    assert_eq!(wire["message"], "请稍候");
    assert_eq!(wire["messageEn"], "Please wait.");
}

use std::collections::HashMap;

use super::protocol::{
    ErrorCode, ExecuteRequest, Execution, Issue, Job, JobState, PreviewKind, Progress,
};

#[derive(Clone, Debug)]
struct PlanContext { game_root: String, kind: PreviewKind }

#[derive(Clone, Debug)]
struct JobRecord {
    request: ExecuteRequest,
    job: Job,
    game_root: Option<String>,
}

#[derive(Default)]
pub struct JobManager {
    jobs: HashMap<String, JobRecord>,
    active_id: Option<String>,
    plans: HashMap<String, PlanContext>,
}

impl JobManager {
    pub fn reserve(&mut self, request: ExecuteRequest) -> Result<Job, Issue> {
        if request.operation_id.trim().is_empty() || request.plan_id.trim().is_empty() {
            return Err(Issue::plain(ErrorCode::PlanMissing, "operationId and planId are required"));
        }
        if let Some(existing) = self.jobs.get(&request.operation_id) {
            if existing.request == request {
                return Ok(existing.job.clone());
            }
            return Err(Issue::plain(ErrorCode::PlanStale, "operationId was already used for a different request"));
        }
        if self.active_id.is_some() {
            return Err(Issue::plain(ErrorCode::Busy, "another installer operation is still unresolved"));
        }
        let job = Job {
            operation_id: request.operation_id.clone(),
            plan_id: request.plan_id.clone(),
            state: JobState::Running,
            progress: None,
            result: None,
            error: None,
        };
        let game_root = self.plans.get(&request.plan_id).map(|p| p.game_root.clone());
        self.active_id = Some(request.operation_id.clone());
        self.jobs.insert(request.operation_id.clone(), JobRecord { request, job: job.clone(), game_root });
        Ok(job)
    }

    pub fn len(&self) -> usize { self.jobs.len() }

    pub fn is_known(&self, operation_id: &str) -> bool { self.jobs.contains_key(operation_id) }

    pub fn has_unresolved(&self) -> bool {
        self.active_id.as_ref().and_then(|id| self.jobs.get(id))
            .map(|r| matches!(r.job.state, JobState::Running | JobState::Unknown))
            .unwrap_or(false)
    }

    pub fn get(&self, operation_id: &str) -> Result<Job, Issue> {
        self.jobs.get(operation_id).map(|r| r.job.clone())
            .ok_or_else(|| Issue::plain(ErrorCode::PlanMissing, "operationId is not known in this app session"))
    }

    pub fn record_plan(&mut self, plan_id: String, game_root: String, kind: PreviewKind) {
        self.plans.clear();
        self.plans.insert(plan_id, PlanContext { game_root, kind });
    }

    pub fn game_root_for_plan(&self, plan_id: &str) -> Option<String> {
        self.plans.get(plan_id).map(|p| p.game_root.clone())
    }

    pub fn kind_for_plan(&self, plan_id: &str) -> Option<PreviewKind> {
        self.plans.get(plan_id).map(|p| p.kind.clone())
    }

    pub fn game_root_for_operation(&self, operation_id: &str) -> Option<String> {
        self.jobs.get(operation_id).and_then(|r| r.game_root.clone())
    }

    pub fn update_progress(&mut self, operation_id: &str, progress: Progress) {
        if let Some(record) = self.jobs.get_mut(operation_id) {
            if record.job.state == JobState::Running { record.job.progress = Some(progress); }
        }
    }

    pub fn mark_finished(&mut self, operation_id: &str, result: Execution) {
        if let Some(record) = self.jobs.get_mut(operation_id) {
            record.job.state = JobState::Finished;
            record.job.result = Some(result);
            record.job.error = None;
            if self.active_id.as_deref() == Some(operation_id) { self.active_id = None; }
        }
    }

    pub fn mark_failed(&mut self, operation_id: &str, issue: Issue) {
        if let Some(record) = self.jobs.get_mut(operation_id) {
            record.job.state = JobState::Failed;
            record.job.error = Some(issue);
            if self.active_id.as_deref() == Some(operation_id) { self.active_id = None; }
        }
    }

    /// The result is not known. The issue keeps both languages; its code always becomes
    /// WORKER_UNAVAILABLE, because an unknown result is never a classified refusal.
    pub fn mark_unknown(&mut self, operation_id: &str, issue: Issue) {
        if let Some(record) = self.jobs.get_mut(operation_id) {
            if record.job.state == JobState::Running {
                record.job.state = JobState::Unknown;
                record.job.result = None;
                record.job.error = Some(Issue { code: ErrorCode::WorkerUnavailable, path: None, ..issue });
            }
        }
    }

    pub fn mark_active_unknown(&mut self, issue: Issue) {
        if let Some(id) = self.active_id.clone() { self.mark_unknown(&id, issue); }
    }

    pub fn mark_reconciled(&mut self, operation_id: &str, issue: Option<Issue>) -> Result<Job, Issue> {
        let record = self.jobs.get_mut(operation_id)
            .ok_or_else(|| Issue::plain(ErrorCode::PlanMissing, "operationId is not known in this app session"))?;
        if record.job.state != JobState::Unknown {
            return Err(Issue::plain(ErrorCode::EngineError, "only an unknown operation can be reconciled"));
        }
        record.job.state = JobState::Reconciled;
        record.job.result = None;
        record.job.error = issue;
        if self.active_id.as_deref() == Some(operation_id) { self.active_id = None; }
        Ok(record.job.clone())
    }

    pub fn can_close(&self) -> bool {
        !self.has_unresolved()
    }
}

use app_lib::installer::profiles::{validate_profile_request, validate_profile_response};
use app_lib::installer::protocol::{validate_read, ErrorCode};
use serde_json::{json, Value};

fn profile() -> Value {
    json!({"schemaVersion":2,"id":"tracking","name":"跟踪练习",
      "theme":{"name":"idk3.json","path":"assets/idk3.json"},
      "audio":{"kill":[{"name":"a.ogg","path":"../sounds/a.ogg"},{"name":"a.ogg","path":"../sounds/a.ogg"}],"spawn":[],"mbsGood":[{"name":"good.wav","path":"good.wav"}],
        "mbsOkay":[{"name":"none.ogg","path":"none.ogg"}],"mbsBad":[{"name":"none.ogg","path":"none.ogg"}],"mbsChangeNow":[{"name":"none.ogg","path":"none.ogg"}]}})
}

#[test]
fn profile_crud_requests_preserve_choices_and_use_a_separate_channel() {
    let p=profile();
    let args=json!({"profile":p});
    assert_eq!(validate_profile_request("profileSave",args.clone()).unwrap(),args);
    for op in ["profileRead","profileDelete"] {
        let args=json!({"id":"tracking"});
        assert_eq!(validate_profile_request(op,args.clone()).unwrap(),args);
    }
    assert_eq!(validate_profile_request("profileList",json!({})).unwrap(),json!({}));
    assert!(validate_read("profileSave",json!({"profile":profile()})).is_err());
    assert!(validate_profile_request("execute",json!({})).is_err());
}

/// Profile v2 (2026-09-30) is a complete snapshot: the theme and all six events are required,
/// never null, and nothing else is accepted -- not the v1 `scheme` key, nor the old crosshair or
/// enemy records (no data migration).
#[test]
fn every_component_is_required_and_nothing_else_is_accepted() {
    for key in ["theme","audio"] {
        let mut null=profile();null[key]=Value::Null;
        assert!(validate_profile_request("profileSave",json!({"profile":null})).is_err(),"null {key}");
        let mut missing=profile();missing.as_object_mut().unwrap().remove(key);
        assert!(validate_profile_request("profileSave",json!({"profile":missing})).is_err(),"missing {key}");
    }
    for event in ["kill","spawn","mbsGood","mbsOkay","mbsBad","mbsChangeNow"] {
        let mut missing=profile();missing["audio"].as_object_mut().unwrap().remove(event);
        assert!(validate_profile_request("profileSave",json!({"profile":missing})).is_err(),"missing {event}");
    }
    for key in ["scheme","crosshair","enemy"] {
        let mut extra=profile();extra[key]=json!({"name":"a.json","path":"C:/a.json"});
        assert!(validate_profile_request("profileSave",json!({"profile":extra})).is_err(),"{key}");
    }
}

#[test]
fn kill_and_spawn_may_be_silent_and_each_mbs_event_holds_one_sound() {
    let mut silent=profile();silent["audio"]["kill"]=json!([]);
    assert!(validate_profile_request("profileSave",json!({"profile":silent})).is_ok());
    for count in [0usize,2] {
        let mut p=profile();p["audio"]["mbsBad"]=json!(vec![json!({"name":"a.ogg","path":"a.ogg"}); count]);
        assert!(validate_profile_request("profileSave",json!({"profile":p})).is_err(),"{count}");
    }
}

#[test]
fn unsafe_profile_ids_and_extra_request_fields_are_rejected() {
    for id in ["../other","a/b","a\\b","CON","con","nul","com1","lpt9","mixedCase","", "a.json"] {
        assert_eq!(validate_profile_request("profileRead",json!({"id":id})).unwrap_err().code,ErrorCode::InvalidPath);
    }
    assert!(validate_profile_request("profileRead",json!({"id":"ok","directory":"C:\\Game"})).is_err());
    assert!(validate_profile_request("profileList",json!({"gameRoot":"C:\\Game"})).is_err());
}

#[test]
fn malformed_component_values_and_versions_are_rejected() {
    let mut bad=Vec::new();
    let mut p=profile();p["schemaVersion"]=json!(1);bad.push(p);
    let mut p=profile();p["schemaVersion"]=json!(true);bad.push(p);
    let mut p=profile();p["name"]=json!("\n");bad.push(p);
    let mut p=profile();p["theme"]=json!({"file":"https://example.test/a.json"});bad.push(p);
    let mut p=profile();p["audio"]=json!({"kill":"a.ogg"});bad.push(p);
    let mut p=profile();p["audio"]=json!({"shoot":["a.wav"]});bad.push(p);
    let mut p=profile();p["extra"]=json!(null);bad.push(p);
    for p in bad { assert!(validate_profile_request("profileSave",json!({"profile":p})).is_err()); }
}

#[test]
fn profile_responses_reject_corruption_id_mismatch_and_duplicate_entries() {
    let args=json!({"id":"tracking"});
    let read=json!({"filePath":"C:/Profiles/tracking.json","profile":profile()});
    assert_eq!(validate_profile_response("profileRead",&args,read.clone()).unwrap(),read);
    let missing=json!({"filePath":"C:/Profiles/tracking.json","profile":null});
    assert!(validate_profile_response("profileRead",&args,missing).is_ok());
    let wrong=json!({"filePath":"C:/Profiles/other.json","profile":profile()});
    assert_eq!(validate_profile_response("profileRead",&args,wrong).unwrap_err().code,ErrorCode::WorkerUnavailable);
    let mut bad=profile();bad["id"]=json!("other");
    assert!(validate_profile_response("profileRead",&args,json!({"filePath":"C:/Profiles/tracking.json","profile":bad})).is_err());
    let list=json!({"directory":"C:/Profiles","profiles":[profile(),profile()],"errors":[]});
    assert!(validate_profile_response("profileList",&json!({}),list).is_err());
    assert!(validate_profile_response("profileDelete",&args,json!({"deleted":true,"extra":1})).is_err());
}

#[test]
fn list_keeps_valid_profiles_and_per_file_errors() {
    let list=json!({"directory":"C:/Profiles","profiles":[profile()],"errors":[{"fileName":"broken.json","message":"配置文件损坏","messageEn":"This Profile file is damaged"}]});
    assert_eq!(validate_profile_response("profileList",&json!({}),list.clone()).unwrap(),list);
    // Each per-file error must carry its own English; Chinese in messageEn is refused.
    let chinese_only=json!({"directory":"C:/Profiles","profiles":[],"errors":[{"fileName":"broken.json","message":"配置文件损坏","messageEn":"配置文件损坏"}]});
    assert!(validate_profile_response("profileList",&json!({}),chinese_only).is_err());
    let save=json!({"filePath":"C:/Profiles/tracking.json","profile":profile()});
    assert!(validate_profile_response("profileSave",&json!({"profile":profile()}),save).is_ok());
}

#[test]
fn asset_read_list_requests_and_responses_are_strict_and_bounded() {
    let args=json!({"kind":"enemy","path":"C:/assets/a.json"});
    assert!(validate_profile_request("profileAssetRead",args.clone()).is_ok());
    let valid=json!({"path":"C:/assets/a.json","mimeType":"application/json","base64":"e30="});
    assert!(validate_profile_response("profileAssetRead",&args,valid.clone()).is_ok());
    for (key,value) in [("path",json!("C:/assets/b.json")),("mimeType",json!("image/png")),("base64",json!("Zh==")),("base64",json!("")),("base64",json!("!!!!")),("base64",json!("========"))] {
        let mut bad=valid.clone();bad[key]=value;assert!(validate_profile_response("profileAssetRead",&args,bad).is_err());
    }
    for path in ["relative.json","a中.json","C:/assets/../a.json","C:/assets/a.json:stream","C:/assets/CON.json","//?/C:/a.json"] {
        assert!(validate_profile_request("profileAssetRead",json!({"kind":"enemy","path":path})).is_err());
    }
    assert!(validate_profile_request("profileAssetRead",json!({"kind":"audio","path":"C:/a.json"})).is_err());
    assert!(validate_profile_request("profileAssetList",json!({"kind":"other","directory":"C:/assets"})).is_err());
    let list_args=json!({"kind":"enemy","directory":"C:/assets"});
    let list=json!({"directory":"C:/assets","files":[{"name":"a.json","path":"C:/assets/a.json"}],"errors":[]});
    assert!(validate_profile_request("profileAssetList",list_args.clone()).is_ok());
    assert!(validate_profile_response("profileAssetList",&list_args,list.clone()).is_ok());
    let mut bad=list.clone();bad["files"][0]["name"]=json!("b.json");assert!(validate_profile_response("profileAssetList",&list_args,bad).is_err());
    let mut bad=list.clone();bad["files"][0]["path"]=json!("C:/elsewhere/a.json");assert!(validate_profile_response("profileAssetList",&list_args,bad).is_err());
    let mut bad=list;bad["files"]=json!(vec![json!({"name":"a.json","path":"C:/assets/a.json"});1001]);assert!(validate_profile_response("profileAssetList",&list_args,bad).is_err());
}

#[test]
fn asset_wire_rejects_unknown_metadata_and_oversized_payloads() {
    let args=json!({"kind":"audio","path":"C:/a.wav"});
    assert!(validate_profile_request("profileAssetRead",json!({"kind":"audio","path":"C:/a.wav","extra":1})).is_err());
    let mut reply=json!({"path":"C:/a.wav","mimeType":"audio/wav","base64":"AQID","extra":1});
    assert!(validate_profile_response("profileAssetRead",&args,reply.clone()).is_err());
    reply.as_object_mut().unwrap().remove("extra");
    reply["base64"]=json!("A".repeat(11_184_812));
    assert!(validate_profile_response("profileAssetRead",&args,reply).is_err());
}

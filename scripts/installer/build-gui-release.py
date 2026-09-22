#!/usr/bin/env python3
"""Build the separate Windows GUI candidate from explicitly supplied, verified inputs."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

HERE=Path(__file__).resolve().parent
_spec=importlib.util.spec_from_file_location('kvk_release',HERE/'build-release.py')
base=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
GUI_FILES=('gui/kvk-gui-worker.ps1','gui/kvk-gui-service.ps1','gui/protocol.schema.json')

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def checked_entries(document):
    entries=document.get('files')
    if not isinstance(entries,list) or not entries:raise ValueError('Runtime inventory missing')
    seen=set();result={}
    for entry in entries:
        name=base.safe_path(entry.get('path'))
        if name.casefold() in seen:raise ValueError('Runtime case collision')
        seen.add(name.casefold())
        if type(entry.get('size')) is not int or entry['size']<0:raise ValueError('Invalid runtime size')
        value=entry.get('sha256','')
        if not isinstance(value,str) or not base.re.fullmatch('[a-f0-9]{64}',value):raise ValueError('Invalid runtime hash')
        result[name]=entry
    return result

def check_file(path,entry):
    base.no_link(path)
    if path.stat().st_size!=entry['size'] or digest(path)!=entry['sha256']:raise ValueError('Input hash mismatch: '+str(path))

def protect_output(output,files,roots):
    for candidate in (output,Path(str(output)+'.sha256')):
        for source in files:
            if candidate.resolve()==source.resolve() or (candidate.exists() and os.path.samefile(candidate,source)):
                raise ValueError('Output would overwrite an input')
        for parent in (candidate,*candidate.parents):
            if parent.exists():
                base.no_link(parent)
                for root in roots:
                    if os.path.samefile(parent,root):raise ValueError('Output is inside an input directory')

def build_gui_release(exe,webview,runtime_lock,pack,runtime,inventory,output):
    exe,webview,runtime_lock,pack,runtime,inventory,output=map(Path,(exe,webview,runtime_lock,pack,runtime,inventory,output))
    if not exe.is_file():raise ValueError('Windows executable missing')
    base.no_link(exe)
    with exe.open('rb') as f:
        if f.read(2)!=b'MZ':raise ValueError('Expected a Windows PE executable')
    for root in (pack,runtime,webview):base.validate_tree(root)
    for path in (runtime_lock,inventory):
        if not path.is_file():raise ValueError('Inventory missing: '+str(path))
        base.no_link(path)
    protect_output(output,[exe,runtime_lock,inventory],[pack,runtime,webview])
    base.validate_output(output,pack,runtime,inventory)
    base.validate_output(Path(str(output)+'.sha256'),pack,runtime,inventory)
    lock=json.loads(runtime_lock.read_text(encoding='utf-8-sig'))
    if lock.get('schemaVersion')!=1 or not isinstance(lock.get('version'),str) or not lock['version']:
        raise ValueError('Invalid runtime version')
    if not isinstance(lock.get('source'),str) or not lock['source'].startswith('https://'):
        raise ValueError('Runtime source URL missing')
    if not base.re.fullmatch('[a-f0-9]{64}',str(lock.get('archiveSha256',''))):raise ValueError('Runtime archive hash missing')
    web_entries=checked_entries(lock)
    if 'msedgewebview2.exe' not in web_entries:raise ValueError('WebView2 executable missing from inventory')
    actual={p.relative_to(webview).as_posix() for p in webview.rglob('*') if p.is_file()}
    if actual!=set(web_entries):raise ValueError('Runtime file inventory differs from supplied runtime')
    entries=base.read_entries(json.loads(inventory.read_text(encoding='utf-8-sig')))
    if any(not base.is_asset(name) for name in entries):raise ValueError('Non-distributable asset in inventory')
    actual_assets={p.relative_to(pack).as_posix() for p in pack.rglob('*') if p.is_file() and base.is_asset(p.relative_to(pack).as_posix())}
    if actual_assets!=set(entries):raise ValueError('Asset inventory mismatch')
    sources={'Aimloom.exe':exe}
    for name,entry in entries.items():check_file(pack/name,entry);sources[base.PACK_NAME+'/'+name]=pack/name
    for name,entry in web_entries.items():check_file(webview/name,entry);sources['webview2/'+name]=webview/name
    for name in base.ROOT_FILES+base.REQUIRED_SCRIPTS+GUI_FILES:
        source=runtime/name
        if not source.is_file():raise ValueError('GUI runtime missing: '+name)
        base.no_link(source)
        sources[name if name in base.ROOT_FILES else 'scripts/'+name]=source
    # Include any engine helper actually shipped by the CLI builder.
    for source in runtime.glob('*.ps1'):
        if not source.name.lower().endswith(('.test.ps1','.tests.ps1')):sources['scripts/'+source.name]=source
    names=set()
    for name in sources:
        base.safe_path(name)
        if name.casefold() in names:raise ValueError('Payload name collision')
        names.add(name.casefold())
    pinned={base.PACK_NAME+'/'+name:entry for name,entry in entries.items()}
    pinned.update({'webview2/'+name:entry for name,entry in web_entries.items()})
    manifest={'schemaVersion':1,'version':base.VERSION,'status':'candidate-windows-gui-acceptance-pending','powerShellMinimum':'7.0',
              'webview':{k:lock[k] for k in ('version','source','archiveSha256')},
              'files':[{'path':name,'size':pinned[name]['size'] if name in pinned else source.stat().st_size,'sha256':pinned[name]['sha256'] if name in pinned else digest(source)} for name,source in sorted(sources.items())]}
    output.parent.mkdir(parents=True,exist_ok=True)
    stage=None;side_stage=None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent,prefix='.kvk-gui-',suffix='.zip',delete=False) as f:stage=Path(f.name)
        with zipfile.ZipFile(stage,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
            for entry in manifest['files']:
                name=entry['path'];source=sources[name]
                info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
                with source.open('rb') as reader,archive.open(info,'w',force_zip64=True) as writer:shutil.copyfileobj(reader,writer,1024*1024)
            archive.writestr('release-manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2).encode('utf-8'))
        with zipfile.ZipFile(stage) as archive:
            if set(archive.namelist())!=set(sources)|{'release-manifest.json'}:raise ValueError('Unexpected ZIP contents')
            for entry in manifest['files']:
                h=hashlib.sha256();size=0
                with archive.open(entry['path']) as member:
                    for chunk in iter(lambda:member.read(1024*1024),b''):h.update(chunk);size+=len(chunk)
                if size!=entry['size'] or h.hexdigest()!=entry['sha256']:raise ValueError('ZIP payload verification failed')
        archive_hash=digest(stage)
        with tempfile.NamedTemporaryFile(dir=output.parent,prefix='.kvk-hash-',delete=False) as f:
            side_stage=Path(f.name);f.write((archive_hash+'  '+output.name+'\n').encode('utf-8'))
        protect_output(output,[exe,runtime_lock,inventory],[pack,runtime,webview])
        os.replace(stage,output);stage=None
        try:os.replace(side_stage,Path(str(output)+'.sha256'));side_stage=None
        except OSError:
            # Never leave an old sidecar claiming to describe the newly verified ZIP.
            Path(str(output)+'.sha256').unlink(missing_ok=True)
            raise
        return {'path':str(output),'sha256':archive_hash,'size':output.stat().st_size,'files':len(sources),'status':manifest['status']}
    finally:
        for path in (stage,side_stage):
            if path is not None:path.unlink(missing_ok=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe',type=Path,required=True)
    parser.add_argument('--webview-dir',type=Path,required=True)
    parser.add_argument('--runtime-lock',type=Path,required=True)
    parser.add_argument('--pack-dir',type=Path,default=HERE.parents[1]/base.PACK_NAME)
    parser.add_argument('--runtime-dir',type=Path,default=HERE)
    parser.add_argument('--inventory',type=Path,default=HERE/'release-inventory.json')
    parser.add_argument('--output',type=Path,default=HERE.parents[1]/'dist'/'KovaaK-Config-GUI-v0.1.0.zip')
    args=parser.parse_args()
    try:print(json.dumps(build_gui_release(args.exe,args.webview_dir,args.runtime_lock,args.pack_dir,args.runtime_dir,args.inventory,args.output),ensure_ascii=False))
    except (OSError,ValueError,zipfile.BadZipFile) as error:parser.exit(1,'GUI build stopped: '+str(error)+'\n')
if __name__=='__main__':main()

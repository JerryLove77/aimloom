import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'build-gui-release.py'

class GuiReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        spec=importlib.util.spec_from_file_location('gui_builder', SCRIPT)
        self.builder=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.builder)
        self.exe=self.root/'app.exe'; self.exe.write_bytes(b'MZ fake test executable')
        self.pack=self.root/'pack'; self.pack.mkdir()
        (self.pack/'UI.json').write_bytes(b'{"exact":true}')
        self.inventory=self.root/'inventory.json'
        self.inventory.write_text(json.dumps({'schemaVersion':1,'version':'0.1.0','files':[self.entry('UI.json',b'{"exact":true}')]}))
        self.runtime=self.root/'scripts-source';self.runtime.mkdir()
        for name in ['kvk-config.ps1','kvk-engine.ps1','安装配置.cmd','恢复配置.cmd','使用说明.txt']:
            (self.runtime/name).write_bytes(b'fixture')
        (self.runtime/'gui').mkdir()
        for name in ['kvk-gui-worker.ps1','kvk-gui-service.ps1','protocol.schema.json']:
            (self.runtime/'gui'/name).write_bytes(b'fixture')
        self.webview=self.root/'webview';self.webview.mkdir()
        for name in ['msedgewebview2.exe','LICENSE.txt']:(self.webview/name).write_bytes(name.encode())
        self.lock=self.root/'runtime-lock.json'
        self.lock.write_text(json.dumps({'schemaVersion':1,'version':'test-fixture','source':'https://developer.microsoft.com/microsoft-edge/webview2/','archiveSha256':'a'*64,'files':[self.entry(p.name,p.read_bytes()) for p in self.webview.iterdir()]}))
        self.output=self.root/'output'/'gui.zip'
    @staticmethod
    def entry(name,data):return {'path':name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    def build(self):return self.builder.build_gui_release(self.exe,self.webview,self.lock,self.pack,self.runtime,self.inventory,self.output)
    def test_preserves_all_runtime_and_pack_bytes_and_sidecar(self):
        result=self.build()
        with zipfile.ZipFile(self.output) as z:
            self.assertEqual(z.read('webview2/LICENSE.txt'),b'LICENSE.txt')
            self.assertEqual(z.read('KVK Settings 2025/UI.json'),b'{"exact":true}')
            self.assertIn('scripts/gui/kvk-gui-worker.ps1',z.namelist())
            self.assertEqual(json.loads(z.read('release-manifest.json'))['powerShellMinimum'],'7.0')
        self.assertEqual(Path(str(self.output)+'.sha256').read_text().split()[0],hashlib.sha256(self.output.read_bytes()).hexdigest())
        self.assertEqual(result['sha256'],hashlib.sha256(self.output.read_bytes()).hexdigest())
    def test_missing_worker_preserves_previous_artifact(self):
        self.output.parent.mkdir();self.output.write_bytes(b'previous good artifact')
        (self.runtime/'gui/kvk-gui-worker.ps1').unlink()
        with self.assertRaises(ValueError):self.build()
        self.assertEqual(self.output.read_bytes(),b'previous good artifact')
    def test_changed_runtime_or_asset_is_rejected(self):
        (self.webview/'msedgewebview2.exe').write_bytes(b'changed')
        with self.assertRaises(ValueError):self.build()
        self.assertFalse(self.output.exists())
    def test_output_cannot_replace_input_executable(self):
        before=self.exe.read_bytes();self.output=self.exe
        with self.assertRaises(ValueError):self.build()
        self.assertEqual(self.exe.read_bytes(),before)
    def test_output_in_runtime_is_rejected(self):
        self.output=self.webview/'bundle.zip'
        with self.assertRaises(ValueError):self.build()
        self.assertFalse(self.output.exists())

    def test_mutation_after_inventory_check_cannot_become_new_manifest_truth(self):
        original=self.builder.check_file
        changed=False
        def mutate_after_check(path,entry):
            nonlocal changed
            original(path,entry)
            if path==self.pack/'UI.json' and not changed:
                path.write_bytes(b'{"changed":true}')
                changed=True
        self.builder.check_file=mutate_after_check
        with self.assertRaises(ValueError):self.build()
        self.assertFalse(self.output.exists())

if __name__=='__main__':unittest.main()

import hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1];REPO='jimmowrey-creator/KRISP-KDS';v=json.loads((ROOT/'version.json').read_text());dist=ROOT/'dist';apk=dist/v['fileName'];meta=json.loads((dist/'update.json').read_text());report=json.loads((dist/'verification.json').read_text())
assert report['signed'] and report['receiverDexUnchanged'];assert hashlib.sha256(apk.read_bytes()).hexdigest()==meta['sha256'];assert (dist/'emulator-result.txt').read_text().startswith('PASS:')
def run(*args):subprocess.run(args,check=True)
notes=ROOT/'RELEASE-NOTES.md'
run('gh','release','create',v['tag'],str(apk),str(dist/'verification.json'),str(dist/'emulator-result.txt'),'--repo',REPO,'--target',subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'--title','KRISP '+v['versionName'],'--notes-file',str(notes))
# Publish discovery metadata only after the APK is publicly downloadable.
import urllib.request
with urllib.request.urlopen(meta['url'],timeout=60) as response:download=response.read()
assert hashlib.sha256(download).hexdigest()==meta['sha256'],'Published APK differs from tested APK'
run('git','config','user.name','github-actions[bot]');run('git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com')
pathlib.Path('update.json').write_text(json.dumps(meta,indent=2)+'\n');run('git','add','update.json');run('git','commit','-m','Publish approved KRISP update metadata [skip ci]');run('git','push','origin','HEAD:main')

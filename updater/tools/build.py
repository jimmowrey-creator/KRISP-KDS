"""Build an auditable updater overlay; never recompile the proven receiver."""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE_SHA='07a895ec73c472898be278ebbb23d5907b3b76c5d2f55df86dd72e74df58b790'
def sha(data): return hashlib.sha256(data).hexdigest()
def run(*args, **kwargs):
    subprocess.run([str(a) for a in args],check=True,**kwargs)
def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',type=pathlib.Path,required=True);p.add_argument('--sdk',type=pathlib.Path,required=True);p.add_argument('--java',type=pathlib.Path,required=True);p.add_argument('--keystore',type=pathlib.Path);p.add_argument('--out',type=pathlib.Path,default=ROOT/'dist');a=p.parse_args()
    a.baseline=a.baseline.resolve();a.sdk=a.sdk.resolve();a.java=a.java.resolve();a.out=a.out.resolve();a.out.mkdir(parents=True,exist_ok=True)
    assert sha(a.baseline.read_bytes())==BASE_SHA,'Baseline must be the proven Build 4 APK'
    with zipfile.ZipFile(a.baseline) as original:
        assert (ROOT/'test/native-print.js').read_bytes()==original.read('assets/web/native-print.js'),'Regression tests must use the unchanged packaged P18 parser'
    v=json.loads((ROOT/'version.json').read_text(encoding='utf-8-sig'));assert isinstance(v['versionCode'],int) and v['versionCode']>34
    assert re.fullmatch(r'KRISP-KDS-[\w.-]+\.apk',v['fileName']);assert re.fullmatch(r'[\w.-]+',v['tag'])
    b=ROOT/'build';b.mkdir(exist_ok=True);classes=b/'classes';stubs=b/'stubs';dex=b/'dex';tests=b/'tests'
    for d in [classes,stubs,dex,tests]:
        # Build outputs only; reject path escape before resetting stale class files.
        assert d.resolve().parent==b.resolve()
        if d.exists(): shutil.rmtree(d)
        d.mkdir()
    suffix='.exe' if os.name=='nt' else '';j=a.java/'bin';bt=a.sdk/'build-tools'/'35.0.0';android=a.sdk/'platforms'/'android-35'/'android.jar'
    run(j/('javac'+suffix),'-source','8','-target','8','-cp',android,'-d',stubs,*sorted((ROOT/'stubs').rglob('*.java')))
    run(j/('javac'+suffix),'-source','8','-target','8','-cp',str(android)+os.pathsep+str(stubs),'-d',classes,*sorted((ROOT/'src').rglob('*.java')))
    run(j/('javac'+suffix),'-cp',classes,'-d',tests,ROOT/'test'/'UpdatePolicyTest.java')
    run(j/('java'+suffix),'-cp',str(classes)+os.pathsep+str(tests),'UpdatePolicyTest')
    run(j/('java'+suffix),'-cp',bt/'lib'/'d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',android,'--classpath',stubs,'--output',dex,*sorted(classes.rglob('*.class')))
    manifest=(ROOT/'AndroidManifest.xml').read_text(encoding='utf-8-sig');manifest=re.sub(r'android:versionCode="[^"]+"',f'android:versionCode="{v["versionCode"]}"',manifest);manifest=re.sub(r'android:versionName="[^"]+"',f'android:versionName="{v["versionName"]}"',manifest)
    (b/'AndroidManifest.xml').write_text(manifest,encoding='utf-8')
    run(bt/('aapt'+suffix),'package','-f','-M',b/'AndroidManifest.xml','-I',android,'-I',a.baseline,'-F',b/'manifest.apk')
    with zipfile.ZipFile(b/'manifest.apk') as z: binary_manifest=z.read('AndroidManifest.xml')
    assert len(list(dex.glob('*.dex')))==1,'Unexpected updater DEX count'
    with zipfile.ZipFile(a.baseline) as original:
        native_dex=[n for n in original.namelist() if re.fullmatch(r'classes\d*\.dex',n)]
    next_dex='classes'+str(len(native_dex)+1)+'.dex'
    replacements={'AndroidManifest.xml':binary_manifest,next_dex:(dex/'classes.dex').read_bytes()}
    for f in sorted((ROOT/'web').iterdir()):
        content=f.read_bytes()
        if f.name=='index.html': content=content.decode('utf-8-sig').replace('v0.3.2 · Build 7',v['versionName']+' · '+v['buildLabel']).replace('Build 7 · Check',v['buildLabel']+' · Check').encode()
        replacements['assets/web/'+f.name]=content
    unsigned=b/'unsigned.apk'
    with zipfile.ZipFile(a.baseline) as original,zipfile.ZipFile(unsigned,'w',zipfile.ZIP_DEFLATED) as z:
        for info in original.infolist():
            if not info.filename.startswith('META-INF/') and info.filename not in replacements:z.writestr(info,original.read(info.filename))
        for name,data in replacements.items():z.writestr(name,data)
    aligned=b/'aligned.apk';run(bt/('zipalign'+suffix),'-f','-p','4',unsigned,aligned)
    apk=a.out/v['fileName']
    if a.keystore:
        # Passwords are read directly from environment by apksigner, never put in command arguments.
        run(j/('java'+suffix),'-jar',bt/'lib'/'apksigner.jar','sign','--ks',a.keystore.resolve(),'--ks-key-alias','androiddebugkey','--ks-pass','env:KRISP_STORE_PASSWORD','--key-pass','env:KRISP_KEY_PASSWORD','--out',apk,aligned)
        run(j/('java'+suffix),'-jar',bt/'lib'/'apksigner.jar','verify','--verbose','--print-certs',apk)
        def certificate(path):
            output=subprocess.check_output([str(j/('java'+suffix)),'-jar',str(bt/'lib'/'apksigner.jar'),'verify','--print-certs',str(path)],text=True)
            return re.findall(r'Signer #\d+ certificate SHA-256 digest: (\w+)',output)
        assert certificate(apk)==certificate(a.baseline),'Signing key does not match the installed Build 4 app'
    else: shutil.copy2(aligned,apk)
    run(bt/('zipalign'+suffix),'-c','-p','4',apk)
    with zipfile.ZipFile(a.baseline) as original,zipfile.ZipFile(apk) as final:
        changed=[name for name in original.namelist() if not name.startswith('META-INF/') and original.read(name)!=final.read(name)]
        assert set(changed)=={'AndroidManifest.xml','assets/web/index.html','assets/web/krisp-core.js'},changed
        added={n for n in final.namelist() if not n.startswith('META-INF/')}-set(original.namelist());assert added=={next_dex,'assets/web/updater.js'},added
        for name in native_dex:assert original.read(name)==final.read(name),'Native code must remain byte-identical: '+name
        (b/'packaged-core.js').write_bytes(final.read('assets/web/krisp-core.js'))
    env={**os.environ,'KRISP_CORE':str(b/'packaged-core.js')};run('node','--test',*sorted((ROOT/'test').glob('*.test.mjs')),env=env)
    report={'baselineSha256':BASE_SHA,'apkSha256':sha(apk.read_bytes()),'receiverDexUnchanged':True,'changedEntries':changed,'version':v,'signed':bool(a.keystore)}
    (a.out/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
    metadata={'packageName':'com.krisp.kdsb4','versionCode':v['versionCode'],'versionName':v['versionName'],'size':apk.stat().st_size,'sha256':report['apkSha256'],'url':f'https://github.com/jimmowrey-creator/KRISP-KDS/releases/download/{v["tag"]}/{v["fileName"]}'}
    (a.out/'update.json').write_text(json.dumps(metadata,indent=2)+'\n');print('Built '+str(apk))
if __name__=='__main__':main()

"""Create a higher-version test candidate and instrumentation; neither is published."""
import json, os, pathlib, subprocess, zipfile
from build import ROOT, run
sdk=pathlib.Path(os.environ['ANDROID_HOME']);java=pathlib.Path(os.environ['JAVA_HOME']);bt=sdk/'build-tools/35.0.0';android=sdk/'platforms/android-35/android.jar';b=ROOT/'smoke';b.mkdir(exist_ok=True)
key=pathlib.Path(os.environ['KRISP_KEYSTORE']);version_file=ROOT/'version.json';saved=version_file.read_bytes();v=json.loads(saved.decode('utf-8-sig'))
try:
 v['versionCode']+=1;v['versionName']+='-smoketest';v['fileName']='KRISP-KDS-smoketest.apk';version_file.write_text(json.dumps(v))
 run('python',ROOT/'tools/build.py','--baseline',os.environ['KRISP_BASELINE'],'--sdk',sdk,'--java',java,'--keystore',key,'--out',b/'candidate')
finally:version_file.write_bytes(saved)
classes=b/'classes';classes.mkdir(exist_ok=True)
run(java/'bin/javac','-source','8','-target','8','-cp',android,'-d',classes,ROOT/'test/UpdateInstallTest.java')
dex=b/'dex';dex.mkdir(exist_ok=True);run(java/'bin/java','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--min-api','26','--lib',android,'--output',dex,*classes.rglob('*.class'))
(b/'AndroidManifest.xml').write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.krisp.update.test"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="35"/><instrumentation android:name="com.krisp.update.test.UpdateInstallTest" android:targetPackage="com.krisp.kdsb4"/><application android:label="KRISP updater tests"/></manifest>')
run(bt/'aapt','package','-f','-M',b/'AndroidManifest.xml','-I',android,'-F',b/'test-unsigned.apk')
with zipfile.ZipFile(b/'test-unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:z.write(dex/'classes.dex','classes.dex')
run(bt/'zipalign','-f','4',b/'test-unsigned.apk',b/'test-aligned.apk')
run(java/'bin/java','-jar',bt/'lib/apksigner.jar','sign','--ks',key,'--ks-key-alias','androiddebugkey','--ks-pass','env:KRISP_STORE_PASSWORD','--key-pass','env:KRISP_KEY_PASSWORD','--out',b/'test.apk',b/'test-aligned.apk')

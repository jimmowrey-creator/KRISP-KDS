import json,os,pathlib,re,subprocess,time,xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[1];v=json.loads((ROOT/'version.json').read_text());b=ROOT/'smoke';out=ROOT/'dist'
def adb(*args):return subprocess.check_output(['adb',*map(str,args)],text=True)
print(adb('install','-r',os.environ['KRISP_BASELINE']))
adb('shell','run-as','com.krisp.kdsb4','mkdir','-p','files')
event={'id':'preserve:1','clock':1,'kind':'print','at':int(time.time()*1000),'orderKey':'preservation-test','station':'kitchen','source':'P18-test','mode':'snapshot','payload':{'number':'9001','type':'Kitchen ticket','items':[{'name':'UPDATER PRESERVATION TEST','qty':1,'modifiers':[]}],'notes':[],'rawText':'ORDER #9001\n1 x UPDATER PRESERVATION TEST'}}
subprocess.run(['adb','shell',"run-as com.krisp.kdsb4 sh -c 'cat > files/krisp-events.json'"],input=json.dumps([event]).encode(),check=True)
print(adb('install','-r',out/v['fileName']));print(adb('install','-r',b/'test.apk'))
adb('shell','appops','set','com.krisp.kdsb4','REQUEST_INSTALL_PACKAGES','allow')
adb('shell','run-as','com.krisp.kdsb4','mkdir','-p','cache')
for file,destination in [(b/'candidate/KRISP-KDS-smoketest.apk','krisp-update.apk'),(b/'candidate/update.json','candidate.json')]:
 subprocess.run(['adb','shell',f"run-as com.krisp.kdsb4 sh -c 'cat > cache/{destination}'"],input=file.read_bytes(),check=True)
instrument_log=(out/'instrumentation.txt').open('w')
instrument=subprocess.Popen(['adb','shell','am','instrument','-w','com.krisp.update.test/com.krisp.update.test.UpdateInstallTest'],stdout=instrument_log,stderr=subprocess.STDOUT)
for attempt in range(60):
 time.sleep(1);result=(out/'instrumentation.txt').read_text()
 if 'installer launched' in result:break
 if instrument.poll() is not None:raise AssertionError(result)
else:raise AssertionError('Instrumentation did not reach installer: '+result)
print(result);assert 'failure=' not in result,result
clicked=False
for attempt in range(15):
 time.sleep(1);adb('shell','uiautomator','dump','/sdcard/installer.xml');adb('pull','/sdcard/installer.xml',out/'installer.xml')
 root=ET.parse(out/'installer.xml').getroot()
 for n in root.iter('node'):
  if n.get('text','').lower() in ['update','install'] and n.get('enabled')=='true':
   xy=list(map(int,re.findall(r'\d+',n.get('bounds'))));adb('shell','input','tap',str((xy[0]+xy[2])//2),str((xy[1]+xy[3])//2));clicked=True;break
 if clicked:break
assert clicked,'Android installer confirmation button was not found'
for attempt in range(30):
 time.sleep(1);info=adb('shell','dumpsys','package','com.krisp.kdsb4')
 if f'versionCode={v["versionCode"]+1} ' in info:break
else:raise AssertionError('Android did not install the higher-version APK')
print(adb('shell','am','start','-W','-n','com.krisp.kdsb4/com.krisp.update.UpdateActivity'))
time.sleep(3)
with (out/'emulator-after-update.png').open('wb') as f:subprocess.run(['adb','exec-out','screencap','-p'],stdout=f,check=True)
crashes=adb('logcat','-d','-b','crash');(out/'crash-log.txt').write_text(crashes);assert 'FATAL EXCEPTION' not in crashes,crashes
saved=json.loads(adb('shell','run-as','com.krisp.kdsb4','cat','files/krisp-events.json'));assert any(e.get('id')=='preserve:1' for e in saved),'Existing ticket data was lost'
(out/'emulator-result.txt').write_text('PASS: Build 4 upgrade; updater bridge; wrong checksum rejected; same-signer higher-version verified; Android confirmation; installation; relaunch; existing ticket data retained.\n')
print('PASS: complete Android installer update and relaunch')

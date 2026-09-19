package com.krisp.update.test;
import android.app.*;import android.content.*;import android.os.*;import android.webkit.*;import org.json.*;import java.io.*;import java.lang.reflect.*;import java.util.concurrent.*;
/** Test-only instrumentation: never packaged in the kitchen APK. */
public final class UpdateInstallTest extends Instrumentation {
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 @Override public void onStart(){Bundle result=new Bundle();try{
  Context c=getTargetContext();Intent launch=c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);Activity activity=startActivitySync(launch);waitForIdleSync();
  Field wf=activity.getClass().getDeclaredField("web");wf.setAccessible(true);WebView web=(WebView)wf.get(activity);
  boolean ready=false;for(int attempt=0;attempt<20;attempt++){
   CountDownLatch done=new CountDownLatch(1);String[] value={""};runOnMainSync(()->web.evaluateJavascript("!!document.getElementById('check-updates') && typeof window.KrispUpdater.check === 'function'",v->{value[0]=v;done.countDown();}));done.await(5,TimeUnit.SECONDS);
   if("true".equals(value[0])){ready=true;break;}Thread.sleep(500);
  }
  if(!ready)throw new AssertionError("Updater button or native bridge missing");
  File apk=new File(c.getCacheDir(),"krisp-update.apk");String json=new String(java.nio.file.Files.readAllBytes(new File(c.getCacheDir(),"candidate.json").toPath()),java.nio.charset.StandardCharsets.UTF_8);JSONObject metadata=new JSONObject(json);
  Method verify=activity.getClass().getDeclaredMethod("verify",File.class,JSONObject.class);verify.setAccessible(true);
  JSONObject bad=new JSONObject(json);bad.put("sha256",new String(new char[64]).replace('\0','0'));
  boolean rejected=false;try{verify.invoke(activity,apk,bad);}catch(InvocationTargetException expected){rejected=expected.getCause() instanceof SecurityException;}
  if(!rejected)throw new AssertionError("Invalid checksum accepted");
  verify.invoke(activity,apk,metadata);
  Field offered=activity.getClass().getDeclaredField("offered"),verified=activity.getClass().getDeclaredField("verified");offered.setAccessible(true);verified.setAccessible(true);offered.set(activity,metadata);verified.set(activity,apk);
  Method install=activity.getClass().getDeclaredMethod("install");install.setAccessible(true);
  runOnMainSync(()->{try{install.invoke(activity);}catch(Exception e){throw new RuntimeException(e);}});
  result.putString("result","Bridge loaded; checksum rejection passed; valid package verified; installer launched");sendStatus(Activity.RESULT_OK,result);
  // Keep the calling activity alive while the external driver confirms installation.
  Thread.sleep(120000);finish(Activity.RESULT_OK,result);
 }catch(Throwable e){result.putString("failure",e.toString());finish(Activity.RESULT_CANCELED,result);}}
}

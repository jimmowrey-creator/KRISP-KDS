package com.krisp.update;
import android.app.*;import android.os.*;import android.content.*;import android.content.pm.*;import android.net.Uri;import android.provider.Settings;import android.view.*;import android.webkit.*;import org.json.JSONObject;import java.io.*;import java.net.*;import java.security.MessageDigest;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.AtomicBoolean;

/** Adds an updater around the unmodified, proven Build 4 receiver activity. */
public final class UpdateActivity extends com.jimskitchen.receiver.KrispActivity {
 private WebView web;private final ExecutorService worker=Executors.newSingleThreadExecutor();private final AtomicBoolean busy=new AtomicBoolean();private JSONObject offered;private File verified;private boolean awaitingPermission;
 @Override public void onCreate(Bundle state){super.onCreate(state);web=findWeb(getWindow().getDecorView());if(web!=null){web.addJavascriptInterface(new Updater(),"KrispUpdater");web.reload();}}
 private WebView findWeb(View v){if(v instanceof WebView)return (WebView)v;if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){WebView w=findWeb(g.getChildAt(i));if(w!=null)return w;}}return null;}
 private void status(String text){runOnUiThread(()->{if(!isFinishing()&&!isDestroyed()&&web!=null)web.evaluateJavascript("window.krispUpdateStatus&&window.krispUpdateStatus("+JSONObject.quote(text)+")",null);});}
 private long version(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
 private long installed()throws Exception{return version(getPackageManager().getPackageInfo(getPackageName(),0));}
 private HttpURLConnection connect(String address)throws Exception{
  for(int hop=0;hop<6;hop++){
   UpdatePolicy.connectionUrl(address);HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setRequestProperty("User-Agent","KRISP-KDS-Updater");c.setRequestProperty("Cache-Control","no-cache");
   int code=c.getResponseCode();if(code>=300&&code<400){String next=c.getHeaderField("Location");c.disconnect();if(next==null)throw new IOException("Missing download address");address=new URL(new URL(address),next).toString();continue;}
   if(code!=200){c.disconnect();throw new IOException("Update server returned "+code);}
   return c;
  }throw new IOException("Too many download redirects");
 }
 private byte[] read(String address,int max)throws Exception{
  HttpURLConnection c=connect(address);try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>max)throw new IOException("Update information is too large");out.write(b,0,n);}return out.toByteArray();
  }finally{c.disconnect();}
 }
 public final class Updater {
  @JavascriptInterface public void check(){if(!busy.compareAndSet(false,true))return;status("Checking for updates…");worker.submit(()->{
   try{
    JSONObject m=new JSONObject(new String(read(UpdatePolicy.MANIFEST,16384),java.nio.charset.StandardCharsets.UTF_8));
    UpdatePolicy.metadata(m.getString("packageName"),m.getLong("versionCode"),m.getLong("size"),m.getString("sha256"),m.getString("url"));
    if(m.getLong("versionCode")<=installed()){status("You have the latest approved version.");return;}
    runOnUiThread(()->{if(isFinishing()||isDestroyed())return;offered=m;status("An update is available.");new AlertDialog.Builder(UpdateActivity.this).setTitle("KRISP update available").setMessage("Download "+m.optString("versionName","the new version")+"? Your tickets and settings will be kept.").setNegativeButton("Later",null).setPositiveButton("Download",(d,w)->download()).show();});
   }catch(Exception e){status("Could not check for updates. Check internet access and try again.");}finally{busy.set(false);}
  });}
 }
 private void download(){if(!busy.compareAndSet(false,true)||offered==null)return;final JSONObject m=offered;status("Downloading update…");worker.submit(()->{
  File temp=new File(getCacheDir(),"krisp-update.part");
  try{
   HttpURLConnection c=connect(m.getString("url"));long total=0;try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(temp)){
    byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1){total+=n;if(total>m.getLong("size")||total>UpdatePolicy.MAX_APK)throw new IOException("Download exceeds expected size");out.write(b,0,n);}out.getFD().sync();
   }finally{c.disconnect();}
   verify(temp,m);
   File destination=new File(getCacheDir(),"krisp-update.apk");if(destination.exists()&&!destination.delete())throw new IOException("Cannot replace cached update");if(!temp.renameTo(destination))throw new IOException("Cannot save update");
   runOnUiThread(()->{if(isFinishing()||isDestroyed())return;verified=destination;offered=m;status("Update verified and ready to install.");new AlertDialog.Builder(UpdateActivity.this).setTitle("Install KRISP update?").setMessage("KRISP will close during installation. Install between orders, then reopen KRISP.").setNegativeButton("Later",null).setPositiveButton("Install",(d,w)->install()).show();});
  }catch(Exception e){temp.delete();status("Update could not be downloaded or verified. Your current version is unchanged. Try again.");}finally{busy.set(false);}
 });}
 private Set<String> signers(PackageInfo p)throws Exception{
  android.content.pm.Signature[] values=Build.VERSION.SDK_INT>=28?(p.signingInfo==null?null:p.signingInfo.getApkContentsSigners()):p.signatures;
  if(values==null||values.length==0)throw new SecurityException("Missing app signature");Set<String> result=new HashSet<>();for(android.content.pm.Signature s:values)result.add(hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));return result;
 }
 private String hex(byte[] bytes){StringBuilder b=new StringBuilder();for(byte v:bytes)b.append(String.format(java.util.Locale.ROOT,"%02x",v&255));return b.toString();}
 private void verify(File file,JSONObject m)throws Exception{
  if(file.length()!=m.getLong("size"))throw new SecurityException("Incomplete update");MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1)digest.update(b,0,n);}
  if(!hex(digest.digest()).equalsIgnoreCase(m.getString("sha256")))throw new SecurityException("Update checksum mismatch");
  int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
  PackageInfo archive=getPackageManager().getPackageArchiveInfo(file.getPath(),flags),current=getPackageManager().getPackageInfo(getPackageName(),flags);
  if(archive==null||!getPackageName().equals(archive.packageName)||version(archive)!=m.getLong("versionCode")||version(archive)<=version(current)||!signers(archive).equals(signers(current)))throw new SecurityException("Update identity mismatch");
 }
 private void install(){
  if(verified==null||offered==null)return;
  if(!getPackageManager().canRequestPackageInstalls()){
   awaitingPermission=true;status("Allow updates from KRISP on the next screen, then return here.");try{startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));}catch(Exception e){awaitingPermission=false;status("Open Android Settings to allow app updates from KRISP.");}return;
  }
  try{verify(verified,offered);Uri uri=Uri.parse("content://"+getPackageName()+".updates/update.apk");Intent intent=new Intent(Intent.ACTION_INSTALL_PACKAGE).setData(uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("KRISP update",uri));startActivity(intent);status("Finish the Android update prompt, then reopen KRISP.");}catch(Exception e){status("Android could not open this update. Check installation permissions and try again.");}
 }
 @Override protected void onResume(){super.onResume();if(awaitingPermission){awaitingPermission=false;if(getPackageManager().canRequestPackageInstalls())install();else status("Installation permission was not enabled. Tap Check for updates when ready.");}}
 @Override protected void onDestroy(){worker.shutdownNow();if(web!=null)web.removeJavascriptInterface("KrispUpdater");super.onDestroy();}
}

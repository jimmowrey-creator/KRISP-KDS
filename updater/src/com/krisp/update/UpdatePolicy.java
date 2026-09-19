package com.krisp.update;
import java.net.URI;
import java.util.Locale;
public final class UpdatePolicy {
 public static final String PACKAGE="com.krisp.kdsb4";
 public static final String MANIFEST="https://raw.githubusercontent.com/jimmowrey-creator/KRISP-KDS/main/update.json";
 public static final long MAX_APK=32L*1024*1024;
 public static void releaseUrl(String url) {
  URI u=URI.create(url);
  if(!"https".equals(u.getScheme())||!"github.com".equals(u.getHost())||u.getUserInfo()!=null||u.getPort()!=-1||u.getQuery()!=null||u.getFragment()!=null||!u.getPath().matches("/jimmowrey-creator/KRISP-KDS/releases/download/[A-Za-z0-9._-]+/KRISP-KDS-[A-Za-z0-9._-]+\\.apk"))throw new IllegalArgumentException("Untrusted update address");
 }
 public static void connectionUrl(String url){
  URI u=URI.create(url);String host=u.getHost();
  if(!"https".equals(u.getScheme())||u.getUserInfo()!=null||u.getPort()!=-1||!("github.com".equals(host)||"raw.githubusercontent.com".equals(host)||"release-assets.githubusercontent.com".equals(host)||"objects.githubusercontent.com".equals(host)))throw new IllegalArgumentException("Untrusted download redirect");
 }
 public static void metadata(String pkg,long version,long size,String sha,String url){
  if(!PACKAGE.equals(pkg)||version<=0||size<=0||size>MAX_APK||sha==null||!sha.toLowerCase(Locale.ROOT).matches("[0-9a-f]{64}"))throw new IllegalArgumentException("Invalid update information");
  releaseUrl(url);
 }
 private UpdatePolicy(){}
}

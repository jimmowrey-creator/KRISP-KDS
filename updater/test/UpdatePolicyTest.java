import com.krisp.update.UpdatePolicy;
public final class UpdatePolicyTest {
 static int assertions=0;
 static void reject(Runnable test){assertions++;try{test.run();}catch(IllegalArgumentException ok){return;}throw new AssertionError("Unsafe update accepted");}
 public static void main(String[] args){
  String url="https://github.com/jimmowrey-creator/KRISP-KDS/releases/download/v0.3.2-build7/KRISP-KDS-0.3.2-Build7.apk";
  UpdatePolicy.metadata(UpdatePolicy.PACKAGE,37,400000,"a".repeat(64),url);assertions++;
  for(String value:new String[]{url.replace("https:","http:"),url.replace("github.com/","github.com.evil.test/"),url.replace("jimmowrey-creator","someone-else"),url+"?x=1",url+"#x",url.replace("github.com/","evil@github.com/"),url.replace("github.com/","github.com:443/"),url.replace(".apk",".zip")})reject(()->UpdatePolicy.releaseUrl(value));
  reject(()->UpdatePolicy.metadata("com.other",37,1,"a".repeat(64),url));reject(()->UpdatePolicy.metadata(UpdatePolicy.PACKAGE,37,0,"a".repeat(64),url));reject(()->UpdatePolicy.metadata(UpdatePolicy.PACKAGE,37,UpdatePolicy.MAX_APK+1,"a".repeat(64),url));reject(()->UpdatePolicy.metadata(UpdatePolicy.PACKAGE,37,10,"wrong",url));
  for(String value:new String[]{"http://github.com/a","https://evil.test/x","https://github.com.evil.test/x","file:///sdcard/update.apk"})reject(()->UpdatePolicy.connectionUrl(value));
  UpdatePolicy.connectionUrl("https://release-assets.githubusercontent.com/x?signature=y");assertions++;
  System.out.println(assertions+" update trust-policy checks passed");
 }
}

package local.dailymotion;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.graphics.Bitmap;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.view.View;
import android.view.WindowInsets;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.util.Map;
import java.util.Collections;
import java.util.HashMap;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private WebView web;
    private String exportText = "";
    private String speechRequestId;
    private String pendingTab;
    private String pendingBackupText;
    private boolean pageReady;
    private HealthConnectBridge health;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (saved != null) { exportText = saved.getString("exportText", ""); speechRequestId=saved.getString("speechRequestId"); }
        if(Build.VERSION.SDK_INT>=34)health=new HealthConnectBridge(this,(id,ok,payload)->js("window.nativeHealthResult?.("+JSONObject.quote(id)+","+ok+","+payload+")"));
        pendingTab=getIntent().getStringExtra("openTab");
        web = new WebView(this);
        web.setBackgroundColor(0xfff6f7f2);
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Bridge(), "Android");
        // WebView suppresses JavaScript confirmation dialogs without a chrome client.
        // Only packaged app.local resources are navigable, so dialogs originate in our own UI.
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view,String url,Bitmap favicon) { pageReady=false; }
            @Override public void onPageFinished(WebView view,String url) {
                if(isFinishing()||isDestroyed())return;
                view.evaluateJavascript("typeof window.restoreBackup === 'function'",ready->{
                    if(isFinishing()||isDestroyed())return;
                    pageReady="true".equals(ready);
                    if(pageReady)deliverPendingBackup();
                });
                openPendingTab();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return !"https".equals(req.getUrl().getScheme()) || !"app.local".equals(req.getUrl().getHost());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                String path = req.getUrl().getPath();
                if (!"https".equals(req.getUrl().getScheme()) || !"app.local".equals(req.getUrl().getHost())) return denied();
                if (path == null || path.equals("/")) path = "/index.html";
                if (!Arrays.asList("/index.html", "/style.css", "/app.js", "/core.js", "/quick-log.js", "/weekly-plan.js", "/coaching.js").contains(path)) return denied();
                try {
                    String mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html";
                    Map<String,String> headers = new HashMap<>(); headers.put("Cache-Control","no-store"); headers.put("X-Content-Type-Options","nosniff");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(path.substring(1)));
                } catch (Exception e) { return denied(); }
            }
        });
        setContentView(web);
        web.loadUrl("https://app.local/index.html");
        ReminderReceiver.schedule(this);
    }
    private WebResourceResponse denied() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private byte[] readLimited(InputStream in, int max) throws Exception {
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
        while((n=in.read(buffer))!=-1){if(out.size()+n>max)throw new Exception("文件或数据过大");out.write(buffer,0,n);}
        return out.toByteArray();
    }
    private void js(String script) { runOnUiThread(() -> { if (web!=null&&!isFinishing()&&!isDestroyed()) web.evaluateJavascript(script, null); }); }
    private void queueBackup(String raw) {
        runOnUiThread(()->{
            if(isFinishing()||isDestroyed())return;
            pendingBackupText=raw;
            if(pageReady)deliverPendingBackup();
        });
    }
    private void deliverPendingBackup() {
        if(!pageReady||pendingBackupText==null||isFinishing()||isDestroyed())return;
        String raw=pendingBackupText;pendingBackupText=null;
        js("window.restoreBackup("+JSONObject.quote(raw)+")");
    }
    private void openPendingTab() {
        if("food".equals(pendingTab)||"training".equals(pendingTab)||"settings".equals(pendingTab)) {js("location.hash="+JSONObject.quote(pendingTab));pendingTab=null;}
    }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent);setIntent(intent);pendingTab=intent.getStringExtra("openTab");openPendingTab(); }
    @Override protected void onResume() { super.onResume(); if (web != null) { ReminderReceiver.schedule(this); js("window.nativeStatusUpdated?.()"); } }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
    @Override protected void onSaveInstanceState(Bundle out) { out.putString("speechRequestId",speechRequestId); super.onSaveInstanceState(out); }
    @Override protected void onDestroy() { pageReady=false;pendingBackupText=null;io.shutdownNow();if(health!=null)health.destroy(); web.removeJavascriptInterface("Android"); web.destroy(); super.onDestroy(); }
    private void speechResult(String id,boolean ok,String text,String error,String code) {
        JSONObject payload=new JSONObject();try{payload.put("text",text);payload.put("error",error);payload.put("code",code);}catch(Exception ignored){}
        js("window.nativeSpeechResult?.("+JSONObject.quote(id)+","+ok+","+payload+")");
    }

    private class Bridge {
        @JavascriptInterface public String read() { return getSharedPreferences("motion", MODE_PRIVATE).getString("state", ""); }
        @JavascriptInterface public boolean save(String json) {
            try {
                if (json.length()>5_000_000) return false;
                JSONObject object=new JSONObject(json);
                if (object.getInt("version")!=1 || !object.has("settings") || !object.has("days")) return false;
                if (!getSharedPreferences("motion",MODE_PRIVATE).edit().putString("state",json).commit()) return false;
                ReminderReceiver.schedule(MainActivity.this); return true;
            } catch(Exception e) { return false; }
        }
        @JavascriptInterface public String getPairToken() { return getSharedPreferences("connection",MODE_PRIVATE).getString("pairToken", ""); }
        @JavascriptInterface public void setPairToken(String value) { getSharedPreferences("connection",MODE_PRIVATE).edit().putString("pairToken",value).apply(); }
        @JavascriptInterface public String testReminder() { return ReminderReceiver.testReminder(MainActivity.this).toString(); }
        @JavascriptInterface public String speechStatus() {
            JSONObject result=new JSONObject();
            try {
                Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                boolean available=intent.resolveActivity(getPackageManager())!=null;
                result.put("available",available);
                result.put("message",available?"已找到系统语音识别入口。中文识别、麦克风权限及是否联网仍需点击语音输入后确认。":"未找到可用的系统语音识别入口。可以使用键盘语音输入，或直接输入文字记录。");
            }catch(RuntimeException e) {
                try{result.put("available",false);result.put("message","暂时无法检查系统语音识别服务。可以先使用键盘语音或文字记录。");}catch(Exception ignored){}
            }catch(Exception e) {
                try{result.put("available",false);result.put("message","系统语音识别状态读取失败。可以先使用键盘语音或文字记录。");}catch(Exception ignored){}
            }
            return result.toString();
        }
        @JavascriptInterface public String notificationStatus() {
            ReminderReceiver.ensureChannel(MainActivity.this);
            String quiet=ReminderReceiver.quietConfigurationStatus(MainActivity.this);
            NotificationManager manager=getSystemService(NotificationManager.class);
            if (!manager.areNotificationsEnabled()) return quiet+"系统通知未开启，请允许通知后再检查提醒。";
            android.app.NotificationChannel channel=manager.getNotificationChannel(ReminderReceiver.CHANNEL);
            if(channel!=null&&channel.getImportance()==NotificationManager.IMPORTANCE_NONE) return quiet+"提醒通知渠道已关闭，请在系统设置中开启。";
            String precision=Build.VERSION.SDK_INT>=31&&!getSystemService(AlarmManager.class).canScheduleExactAlarms()?"未允许精准闹钟，将使用可能延迟的系统提醒。":"已允许按设定时间安排提醒，仍可能受系统限制。";
            String sound=channel!=null&&(channel.getImportance()<NotificationManager.IMPORTANCE_HIGH||channel.getSound()==null)?"当前渠道未开启高优先级或声音，可在通知设置中调整。":"声音与振动遵守通知渠道和勿扰设置。";
            String vendor="huawei".equalsIgnoreCase(Build.MANUFACTURER)?"华为手机还需检查系统“应用启动管理”的自启动和后台活动，以及锁屏通知；菜单以当前系统为准。":"";
            return quiet+precision+sound+"强行停止应用后需要重新打开；请允许手机后台运行。"+vendor;
        }
        @JavascriptInterface public void requestNotifications() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},10);
                else if(!getSystemService(NotificationManager.class).areNotificationsEnabled()) startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));
                else js("window.nativeStatusUpdated?.()");
            });
        }
        @JavascriptInterface public void openNotificationSettings() {
            runOnUiThread(()->{ReminderReceiver.ensureChannel(MainActivity.this);startActivity(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,ReminderReceiver.CHANNEL));});
        }
        @JavascriptInterface public void requestExactAlarms() {
            runOnUiThread(()->{
                if(Build.VERSION.SDK_INT>=31&&!getSystemService(AlarmManager.class).canScheduleExactAlarms()) {
                    try{startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));}catch(ActivityNotFoundException e){js("window.nativeStatusUpdated?.()");}
                }else js("window.nativeStatusUpdated?.()");
            });
        }
        @JavascriptInterface public void requestSpeech(String id) {
            runOnUiThread(()->{
                if(speechRequestId!=null){speechResult(id,false,"","语音识别正在进行","busy");return;}
                Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_LANGUAGE,"zh-CN").putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true).putExtra(RecognizerIntent.EXTRA_PROMPT,"说出吃了什么和份量，例如：午餐米饭150克、鸡胸肉100克");
                speechRequestId=id;
                try{startActivityForResult(intent,30);}
                catch(ActivityNotFoundException e){speechRequestId=null;speechResult(id,false,"","手机没有可用的系统语音识别服务，请使用键盘语音输入或文字记录","unavailable");}
                catch(SecurityException e){speechRequestId=null;speechResult(id,false,"","系统语音识别服务无权限，请检查其麦克风设置","error");}
            });
        }
        @JavascriptInterface public void requestHealthPermissions() {
            runOnUiThread(()->{if(health!=null)health.requestPermissions();else healthUnavailable("permissions");});
        }
        @JavascriptInterface public void healthSnapshot(String id) {
            if(health!=null)health.snapshot(id);else healthUnavailable(id);
        }
        @JavascriptInterface public void exportBackup(String json) { exportText=json; runOnUiThread(() -> startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"daily-motion-backup.json"),20)); }
        @JavascriptInterface public void importBackup() { runOnUiThread(() -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),21)); }
        @JavascriptInterface public void openBrowser(String url) {
            try { Uri uri=Uri.parse(url); if("https".equals(uri.getScheme())&&"api.prod.whoop.com".equals(uri.getHost()))runOnUiThread(()->startActivity(new Intent(Intent.ACTION_VIEW,uri))); } catch(Exception ignored) {}
        }
        @JavascriptInterface public void api(String id,String base,String path,String method) {
            // Bind the credential to this invocation, even if it waits behind an older request.
            final String requestToken=getPairToken();
            io.submit(() -> {
                boolean ok=false; JSONObject payload;
                HttpsURLConnection conn=null;
                try {
                    URL target=new URL(base+path);
                    if(!target.getProtocol().equals("https")||target.getUserInfo()!=null||(!path.startsWith("/api/snapshot?")&&!path.equals("/api/authorize")&&!path.equals("/api/disconnect")&&!path.equals("/api/status")))throw new Exception("服务地址或请求路径无效");
                    conn=(HttpsURLConnection)target.openConnection();
                    conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(15000);conn.setReadTimeout(20000);
                    conn.setRequestMethod(method.equals("POST")?"POST":"GET");
                    conn.setRequestProperty("Authorization","Bearer "+requestToken);
                    int status=conn.getResponseCode();ok=status>=200&&status<300;
                    try(InputStream in=ok?conn.getInputStream():conn.getErrorStream()) {
                        if(in==null)throw new Exception("同步服务没有响应");
                        byte[] bytes=readLimited(in,2_000_000);
                        payload=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
                    }
                } catch(Exception e) { ok=false;payload=new JSONObject(); try{payload.put("error","连接失败，请检查服务地址、连接密钥与 WHOOP 授权状态");}catch(Exception ignored){} }
                finally {if(conn!=null)conn.disconnect();}
                js("window.nativeApiResult("+JSONObject.quote(id)+","+ok+","+payload+")");
            });
        }
    }
    private void healthUnavailable(String id) {
        JSONObject payload=new JSONObject();try{payload.put("error","本轻量版本的 Health Connect 直连需要 Android 14 或更新版本；仍可手动记录或使用 WHOOP API 服务。");payload.put("code","unavailable");}catch(Exception ignored){}
        js("window.nativeHealthResult?.("+JSONObject.quote(id)+",false,"+payload+")");
    }
    @Override public void onRequestPermissionsResult(int req,String[] permissions,int[] grants) { super.onRequestPermissionsResult(req,permissions,grants);if(health!=null)health.onRequestPermissionsResult(req,permissions,grants);js("window.nativeStatusUpdated?.()"); }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==30){
            String id=speechRequestId;speechRequestId=null;if(id==null)return;
            ArrayList<String> values=data==null?null:data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if(result==RESULT_OK&&values!=null&&!values.isEmpty()&&!values.get(0).trim().isEmpty())speechResult(id,true,values.get(0).trim(),"","");
            else speechResult(id,false,"",result==RESULT_CANCELED?"已取消语音输入":"未识别到文字，请重试或手动输入",result==RESULT_CANCELED?"cancelled":"error");
            return;
        }
        if(result!=RESULT_OK||data==null||data.getData()==null)return;
        Uri uri=data.getData();
        io.submit(()->{
            try {
                if(request==20) {try(OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new Exception();String backup=exportText.isEmpty()?getSharedPreferences("motion",MODE_PRIVATE).getString("state",""):exportText;out.write(backup.getBytes(StandardCharsets.UTF_8));}}
                if(request==21) {try(InputStream in=getContentResolver().openInputStream(uri)){if(in==null)throw new Exception();byte[] bytes=readLimited(in,5_000_000);queueBackup(new String(bytes,StandardCharsets.UTF_8));}}
            } catch(Exception e) {runOnUiThread(()->android.widget.Toast.makeText(this,"文件操作失败，请检查文件与存储空间",android.widget.Toast.LENGTH_LONG).show());}
        });
    }
}

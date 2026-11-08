package local.dailymotion;

import android.annotation.TargetApi;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.OutcomeReceiver;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.DataOrigin;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.SleepSessionRecord;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Consumer;

/** Optional Android 14+ reader. No WHOOP secret, cloud server, Kotlin or extra SDK dependency. */
public final class HealthConnectBridge {
    public interface Callback { void onResult(String id, boolean ok, JSONObject payload); }
    public static final int PERMISSION_REQUEST = 8201;
    private static final String WHOOP_PACKAGE = "com.whoop.android";
    private static final String READ_SLEEP = "android.permission.health.READ_SLEEP";
    private static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";
    private final Activity activity;
    private final Callback callback;
    private boolean destroyed;
    private boolean reading;

    public HealthConnectBridge(Activity activity, Callback callback) { this.activity=activity; this.callback=callback; }
    private boolean granted() { return activity.checkSelfPermission(READ_SLEEP)==PackageManager.PERMISSION_GRANTED && activity.checkSelfPermission(READ_EXERCISE)==PackageManager.PERMISSION_GRANTED; }
    private boolean available() {
        if (Build.VERSION.SDK_INT<34) return false;
        try { return Platform.available(activity); } catch (RuntimeException | LinkageError e) { return false; }
    }
    public String status() {
        if(Build.VERSION.SDK_INT<34) return "第一版本机同步需要 Android 14 或更高版本；当前可继续手动记录。";
        if(!available()) return "系统没有可用的 Health Connect 服务；部分无 Google 服务的手机不支持，请继续手动记录。";
        return granted()?"已允许读取睡眠和运动；还需在 WHOOP 中开启 Health Connect 分享。":"尚未允许读取睡眠和运动。可以授权，或继续手动记录。";
    }
    private void emit(String id, boolean ok, JSONObject payload) { if(!destroyed&&!activity.isFinishing()) callback.onResult(id,ok,payload); }
    private void error(String id,String code,String text) {
        JSONObject p=new JSONObject();try{p.put("error",text);p.put("code",code);p.put("source","health-connect");}catch(Exception ignored){} emit(id,false,p);
    }
    public void requestPermissions() {
        activity.runOnUiThread(() -> {
            if(!available()){error("permissions","UNAVAILABLE",status());return;}
            if(granted()){permissionsResult();return;}
            try { activity.requestPermissions(new String[]{READ_SLEEP,READ_EXERCISE},PERMISSION_REQUEST); }
            catch(RuntimeException e){error("permissions","PERMISSION_REQUEST_FAILED","无法打开健康数据授权。可在系统 Health Connect 设置中授权，或继续手动记录。");}
        });
    }
    public boolean onRequestPermissionsResult(int requestCode,String[] permissions,int[] results) {
        if(requestCode!=PERMISSION_REQUEST)return false;
        permissionsResult();return true;
    }
    private void permissionsResult() {
        if(!granted()){error("permissions","PERMISSION_DENIED","尚未同时允许睡眠与运动读取。不会读取你的数据；你可以继续手动记录，或到系统 Health Connect 设置修改权限。");return;}
        JSONObject p=new JSONObject();try{p.put("granted",true);p.put("source","health-connect");p.put("message","权限已允许。请确认 WHOOP 已分享睡眠与运动，然后点击同步。");}catch(Exception ignored){}emit("permissions",true,p);
    }
    public void snapshot(String id) {
        activity.runOnUiThread(() -> {
            if(!available()){error(id,"UNAVAILABLE",status());return;}
            if(!granted()){error(id,"PERMISSION_DENIED","先允许读取睡眠与运动，再同步；也可以继续手动记录。");return;}
            if(reading){error(id,"BUSY","正在读取健康数据，请稍后再试。");return;}
            reading=true;
            try { new Platform(activity).snapshot(result->{reading=false;emit(id,true,result);},e->{reading=false;error(id,"READ_FAILED",e instanceof SecurityException?"健康数据权限已撤销，请重新授权或手动记录。":"读取失败：请检查系统 Health Connect 服务和 WHOOP 分享设置，稍后重试；手动记录仍可使用。");}); }
            catch(RuntimeException | LinkageError e){reading=false;error(id,"READ_FAILED","当前系统无法读取 Health Connect，手动记录仍可使用。");}
        });
    }
    public void destroy() { destroyed=true; }

    /** Isolate API 34 class references so the optional feature does not load them on older Android. */
    @TargetApi(34)
    private static final class Platform {
        final Activity activity;
        final HealthConnectManager manager;
        final ZoneId timezone=ZoneId.systemDefault();
        final String firstDay=LocalDate.now(timezone).minusDays(6).toString();
        final Instant end=Instant.now();
        final Instant start=LocalDate.now(timezone).minusDays(7).atStartOfDay(timezone).toInstant();
        Platform(Activity activity){this.activity=activity;manager=activity.getSystemService(HealthConnectManager.class);}
        static boolean available(Activity activity){return activity.getSystemService(HealthConnectManager.class)!=null;}
        void snapshot(Consumer<JSONObject> done,Consumer<Exception> failed) {
            read(SleepSessionRecord.class,-1,new ArrayList<>(),0,sleeps ->
                read(ExerciseSessionRecord.class,-1,new ArrayList<>(),0,workouts -> {
                    try { done.accept(convert(sleeps,workouts)); } catch(Exception e){failed.accept(e);}
                },failed),failed);
        }
        <T extends android.health.connect.datatypes.Record> void read(Class<T> type,long token,List<T> records,int page,Consumer<List<T>> done,Consumer<Exception> failed) {
            if(page>=20){failed.accept(new IllegalStateException("Health record page limit"));return;}
            ReadRecordsRequestUsingFilters.Builder<T> builder=new ReadRecordsRequestUsingFilters.Builder<>(type)
                .addDataOrigins(new DataOrigin.Builder().setPackageName(WHOOP_PACKAGE).build())
                .setTimeRangeFilter(new TimeInstantRangeFilter.Builder().setStartTime(start).setEndTime(end).build())
                .setPageSize(200);
            if(token>=0)builder.setPageToken(token);else builder.setAscending(false);
            manager.readRecords(builder.build(),activity.getMainExecutor(),new OutcomeReceiver<ReadRecordsResponse<T>,HealthConnectException>() {
                @Override public void onResult(ReadRecordsResponse<T> result) {
                    records.addAll(result.getRecords());
                    long next=result.getNextPageToken();if(next>=0)read(type,next,records,page+1,done,failed);else done.accept(records);
                }
                @Override public void onError(HealthConnectException e){failed.accept(e);}
            });
        }
        private JSONObject day(Map<String,JSONObject> days,String date) throws Exception {
            JSONObject d=days.get(date);
            if(d==null){d=new JSONObject().put("date",date).put("score",JSONObject.NULL).put("sleepHours",JSONObject.NULL).put("workouts",new JSONArray()).put("source","health-connect");days.put(date,d);}return d;
        }
        private double sleepHours(SleepSessionRecord sleep) {
            List<Instant[]> spans=new ArrayList<>();
            for(SleepSessionRecord.Stage stage:sleep.getStages()) {
                int type=stage.getType();
                if(type==SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING || type==SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_LIGHT || type==SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_DEEP || type==SleepSessionRecord.StageType.STAGE_TYPE_SLEEPING_REM) {
                    Instant a=stage.getStartTime().isBefore(sleep.getStartTime())?sleep.getStartTime():stage.getStartTime();
                    Instant b=stage.getEndTime().isAfter(sleep.getEndTime())?sleep.getEndTime():stage.getEndTime();
                    if(b.isAfter(a))spans.add(new Instant[]{a,b});
                }
            }
            if(spans.isEmpty())return -1; // No stages: do not label whole session time as actual sleep.
            spans.sort(Comparator.comparing(p->p[0]));
            Instant a=spans.get(0)[0],b=spans.get(0)[1];long millis=0;
            for(int i=1;i<spans.size();i++){Instant[] s=spans.get(i);if(!s[0].isAfter(b)){if(s[1].isAfter(b))b=s[1];}else{millis+=Duration.between(a,b).toMillis();a=s[0];b=s[1];}}
            return (millis+Duration.between(a,b).toMillis())/3600000.0;
        }
        JSONObject convert(List<SleepSessionRecord> sleeps,List<ExerciseSessionRecord> workouts) throws Exception {
            Map<String,JSONObject> days=new TreeMap<>(Comparator.reverseOrder());
            Map<String,Double> longest=new TreeMap<>();
            HashSet<String> seenWorkouts=new HashSet<>();
            for(SleepSessionRecord s:sleeps) {
                if(!WHOOP_PACKAGE.equals(s.getMetadata().getDataOrigin().getPackageName()))continue;
                double session=Duration.between(s.getStartTime(),s.getEndTime()).toMillis()/3600000.0;
                if(session<=0||session>48)continue;
                String date=s.getEndTime().atZone(timezone).toLocalDate().toString();
                if(date.compareTo(firstDay)<0)continue;
                if(longest.containsKey(date)&&longest.get(date)>=session)continue;
                longest.put(date,session);JSONObject d=day(days,date);double actual=sleepHours(s);
                d.put("sleepHours",actual>=0?actual:JSONObject.NULL);
                d.put("sleepSessionHours",session);
                d.put("sleepBasis",actual>=0?"stages":"session-only");
            }
            for(ExerciseSessionRecord w:workouts) {
                if(!WHOOP_PACKAGE.equals(w.getMetadata().getDataOrigin().getPackageName()))continue;
                String key=w.getMetadata().getId();if(!seenWorkouts.add(key))continue;
                double minutes=Duration.between(w.getStartTime(),w.getEndTime()).toMillis()/60000.0;if(minutes<0||minutes>1440)continue;
                String date=w.getStartTime().atZone(timezone).toLocalDate().toString();if(date.compareTo(firstDay)<0)continue;JSONObject d=day(days,date);
                String name=w.getTitle()==null?"WHOOP 运动":w.getTitle().toString();
                d.getJSONArray("workouts").put(new JSONObject().put("id","health-connect:"+key).put("sportId",w.getExerciseType()).put("minutes",minutes).put("start",w.getStartTime().toString()).put("name",name));
            }
            JSONArray result=new JSONArray();for(JSONObject d:days.values())result.put(d);
            return new JSONObject().put("records",result).put("syncedAt",Instant.now().toString()).put("source","health-connect").put("sourcePackage",WHOOP_PACKAGE)
                .put("message",result.length()==0?"读取成功，但最近 7 天未发现 WHOOP 分享的睡眠或运动。请先在 WHOOP 中开启 Health Connect 分享并完成设备同步。":"已读取 WHOOP 分享的睡眠与运动。恢复分数不在本机同步范围内。");
        }
    }
}

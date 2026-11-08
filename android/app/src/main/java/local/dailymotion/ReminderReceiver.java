package local.dailymotion;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Calendar;
import java.util.Locale;
import java.text.SimpleDateFormat;

/** Two daily checks with a bounded follow-up chain. No continuously running service. */
public class ReminderReceiver extends BroadcastReceiver {
    static final String CHANNEL = "daily-motion-important-v1";
    private static final String ALARM = "local.dailymotion.REMIND";
    private static final String SNOOZE = "local.dailymotion.SNOOZE";
    private static final long MINUTE = 60_000L;
    private static final int TEST_NOTIFICATION_ID = 9001;

    static JSONObject state(Context c) throws Exception {
        return new JSONObject(c.getSharedPreferences("motion", Context.MODE_PRIVATE).getString("state", "{}"));
    }
    private static SharedPreferences tracking(Context c) { return c.getSharedPreferences("reminder-tracking", Context.MODE_PRIVATE); }
    private static String date(long millis) { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new java.util.Date(millis)); }
    private static int bounded(JSONObject settings, String name, int fallback, int min, int max) {
        return Math.max(min, Math.min(max, settings.optInt(name, fallback)));
    }
    private static int minuteOfDay(String time, int fallback) {
        if (time == null || !time.matches("([01][0-9]|2[0-3]):[0-5][0-9]")) return fallback;
        return Integer.parseInt(time.substring(0,2))*60+Integer.parseInt(time.substring(3));
    }
    private static long atTime(long reference, int minutes) {
        Calendar day=Calendar.getInstance();day.setTimeInMillis(reference);day.set(Calendar.HOUR_OF_DAY,minutes/60);day.set(Calendar.MINUTE,minutes%60);day.set(Calendar.SECOND,0);day.set(Calendar.MILLISECOND,0);return day.getTimeInMillis();
    }
    private static long nextDay(long millis) { Calendar day=Calendar.getInstance();day.setTimeInMillis(millis);day.add(Calendar.DATE,1);return day.getTimeInMillis(); }
    private static boolean quietMinute(JSONObject settings,int minute) {
        int start=minuteOfDay(settings.optString("quietStart","22:30"),22*60+30);
        int end=minuteOfDay(settings.optString("quietEnd","07:00"),7*60);
        if(start==end)return false;
        return start>end?minute>=start||minute<end:minute>=start&&minute<end;
    }
    static String quietConfigurationStatus(Context c) {
        try {
            JSONObject settings=state(c).getJSONObject("settings");
            if(!settings.optBoolean("reminders",false))return "";
            boolean training=quietMinute(settings,baseMinutes(settings,1)),food=quietMinute(settings,baseMinutes(settings,2));
            if(!training&&!food)return "";
            return (training&&food?"训练、饮食":training?"训练":"饮食")+"检查时间位于静默时段，此提醒已暂停，请调整设置。";
        } catch(Exception e) { return ""; }
    }
    private static long allowedTime(long millis, JSONObject settings) {
        int start=minuteOfDay(settings.optString("quietStart","22:30"),22*60+30);
        int end=minuteOfDay(settings.optString("quietEnd","07:00"),7*60);
        if(start==end)return millis;
        Calendar cal=Calendar.getInstance();cal.setTimeInMillis(millis);int now=cal.get(Calendar.HOUR_OF_DAY)*60+cal.get(Calendar.MINUTE);
        if(start>end) {
            if(now>=start)return atTime(nextDay(millis),end);
            if(now<end)return atTime(millis,end);
        } else if(now>=start&&now<end)return atTime(millis,end);
        return millis;
    }
    private static int baseMinutes(JSONObject settings,int kind) {
        return minuteOfDay(settings.optString(kind==1?"trainingTime":"mealTime",kind==1?"18:30":"20:30"),kind==1?18*60+30:20*60+30);
    }
    private static long quietSafeCheck(long requested,JSONObject settings,int kind) {
        long allowed=allowedTime(requested,settings);
        // A late catch-up must not use tomorrow morning's allowance for yesterday's goal.
        return date(allowed).equals(date(requested))?allowed:allowedTime(atTime(nextDay(requested),baseMinutes(settings,kind)),settings);
    }
    /** A never-opened day uses its weekly templates, without rewriting JSON behind the UI. */
    private static boolean pending(JSONObject data,int kind,long now) {
        JSONObject days=data.optJSONObject("days"),day=days==null?null:days.optJSONObject(date(now));
        if(kind==2) {
            JSONArray notes=day==null?null:day.optJSONArray("foodNotes");
            return day==null||!day.optBoolean("foodComplete",false)||(notes!=null&&notes.length()>0);
        }
        JSONArray tasks=day==null?null:day.optJSONArray("tasks");
        if(tasks!=null) {
            for(int i=0;i<tasks.length();i++) { JSONObject task=tasks.optJSONObject(i);if(task!=null&&task.optString("status","pending").equals("pending"))return true; }
            return false;
        }
        JSONArray plans=data.optJSONArray("plans");Calendar cal=Calendar.getInstance();cal.setTimeInMillis(now);int weekday=cal.get(Calendar.DAY_OF_WEEK)-1;
        if(plans!=null)for(int i=0;i<plans.length();i++) {
            JSONObject plan=plans.optJSONObject(i);JSONArray weekdays=plan==null?null:plan.optJSONArray("weekdays");
            if(plan!=null&&!plan.optString("startDate","").isEmpty()&&date(now).compareTo(plan.optString("startDate"))<0)continue;
            if(weekdays!=null)for(int j=0;j<weekdays.length();j++)if(weekdays.optInt(j,-1)==weekday)return true;
        }
        return false;
    }
    private static String shortName(JSONObject task) {
        String name=task.optString("name","").trim();
        return name.length()>24?name.substring(0,24)+"…":name;
    }
    /** Only confirmed local check marks are evidence; a missing day stays unknown. */
    private static String recentTrainingText(JSONObject data,long now) {
        JSONObject days=data.optJSONObject("days");
        int recorded=0,done=0,strengthDays=0;
        for(int offset=1;offset<=2;offset++) {
            Calendar previous=Calendar.getInstance();previous.setTimeInMillis(now);previous.add(Calendar.DATE,-offset);
            JSONObject day=days==null?null:days.optJSONObject(date(previous.getTimeInMillis()));
            if(day==null)continue;
            recorded++;boolean strength=false;JSONArray tasks=day.optJSONArray("tasks");
            if(tasks!=null)for(int i=0;i<tasks.length();i++) {
                JSONObject task=tasks.optJSONObject(i);
                if(task==null||!task.optString("status","pending").equals("done")||task.optString("category").equals("休息"))continue;
                done++;if(task.optString("category").equals("力量"))strength=true;
            }
            if(strength)strengthDays++;
        }
        if(strengthDays==2)return "前两天均有力量项目完成，开始前先确认疲劳，需要时调整安排。";
        if(recorded==0)return "前两天未记录，按实际状态安排，不作漏练判断。";
        return "前两天记录中有 "+done+" 项运动完成"+(recorded<2?"，另一天未记录":"")+"。";
    }
    private static String notificationText(JSONObject data,JSONObject settings,int kind,long now) {
        JSONObject days=data.optJSONObject("days"),day=days==null?null:days.optJSONObject(date(now));
        if(kind==2) {
            double calories=0,protein=0;JSONArray meals=day==null?null:day.optJSONArray("meals");
            if(meals!=null)for(int i=0;i<meals.length();i++) {
                JSONObject meal=meals.optJSONObject(i);if(meal!=null){calories+=meal.optDouble("calories",0);protein+=meal.optDouble("protein",0);}
            }
            String text="今日已记录 "+Math.round(calories)+" kcal、蛋白质 "+String.format(Locale.US,"%.1f",protein)+" g。";
            double calorieTarget=settings.optDouble("calories",0),proteinTarget=settings.optDouble("protein",0);
            if(calorieTarget>0) {
                long difference=Math.round(calories-calorieTarget);
                text+=difference>0?"已记录热量高于自设目标 "+difference+" kcal，先核对份量。":"距自设热量目标尚余 "+Math.abs(difference)+" kcal。";
            }
            if(proteinTarget>0)text+="蛋白质记录进度 "+String.format(Locale.US,"%.1f",protein)+" / "+String.format(Locale.US,"%.1f",proteinTarget)+" g。";
            JSONArray notes=day==null?null:day.optJSONArray("foodNotes");
            if(notes!=null&&notes.length()>0)text+="另有 "+notes.length()+" 条备注未计入。";
            return text+"饮食尚未记全，说一句补录，确认后保存。";
        }
        JSONArray tasks=day==null?null:day.optJSONArray("tasks");
        boolean templates=tasks==null;
        if(templates)tasks=data.optJSONArray("plans");
        Calendar calendar=Calendar.getInstance();calendar.setTimeInMillis(now);int weekday=calendar.get(Calendar.DAY_OF_WEEK)-1;
        int count=0;StringBuilder names=new StringBuilder();
        if(tasks!=null)for(int i=0;i<tasks.length();i++) {
            JSONObject task=tasks.optJSONObject(i);if(task==null)continue;
            if(templates) {
                if(!task.optString("startDate","").isEmpty()&&date(now).compareTo(task.optString("startDate"))<0)continue;
                JSONArray weekdays=task.optJSONArray("weekdays");boolean matches=false;
                if(weekdays!=null)for(int j=0;j<weekdays.length();j++)if(weekdays.optInt(j,-1)==weekday)matches=true;
                if(!matches)continue;
            } else if(!task.optString("status","pending").equals("pending"))continue;
            if(count<2){if(names.length()>0)names.append("、");names.append(shortName(task));}count++;
        }
        return "今天还有 "+count+" 项待确认"+(names.length()>0?"："+names:"")+"。"+recentTrainingText(data,now)+"打开后逐项勾选，或调整安排。";
    }
    private static PendingIntent alarmIntent(Context c,int kind,long at) {
        Intent intent=new Intent(c,ReminderReceiver.class).setAction(ALARM).putExtra("kind",kind).putExtra("day",date(at));
        return PendingIntent.getBroadcast(c,kind,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private static void cancel(Context c,int kind) {
        c.getSystemService(AlarmManager.class).cancel(alarmIntent(c,kind,System.currentTimeMillis()));
        tracking(c).edit().remove("next_"+kind).remove("target_"+kind).apply();
        c.getSystemService(NotificationManager.class).cancel(kind);
    }
    private static void setNext(Context c,int kind,long at,String signature) {
        AlarmManager alarms=c.getSystemService(AlarmManager.class);
        PendingIntent intent=alarmIntent(c,kind,at);
        // Replacing a due event with an imminent event preserves it; never cancel then move it to tomorrow.
        if(Build.VERSION.SDK_INT<31||alarms.canScheduleExactAlarms()) {
            try {alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);}
            catch(SecurityException e) {alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);}
        } else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent);
        tracking(c).edit().putLong("next_"+kind,at).putString("target_"+kind,date(at)).putString("signature_"+kind,signature).apply();
    }
    static void ensureChannel(Context c) {
        NotificationChannel channel=new NotificationChannel(CHANNEL,"每日目标强提醒",NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("训练和饮食未完成时，按设置有限次数提醒；声音和振动由系统设置控制。");
        channel.enableVibration(true);channel.setVibrationPattern(new long[]{0,250,180,250});
        channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI,new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).build());
        c.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    /** User-triggered installation check. This never schedules an alarm or changes daily reminder counters. */
    static JSONObject testReminder(Context c) {
        JSONObject result=new JSONObject();
        try {
            if(Build.VERSION.SDK_INT>=33&&c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                return result.put("ok",false).put("message","系统尚未允许通知。请先允许本应用通知，再测试提醒。");
            NotificationManager manager=c.getSystemService(NotificationManager.class);
            if(!manager.areNotificationsEnabled())return result.put("ok",false).put("message","系统通知已关闭。请在通知设置中开启后再测试。");
            ensureChannel(c);
            NotificationChannel channel=manager.getNotificationChannel(CHANNEL);
            if(channel==null||channel.getImportance()==NotificationManager.IMPORTANCE_NONE)
                return result.put("ok",false).put("message","每日目标提醒渠道已关闭。请在通知设置中开启此渠道后再测试。");
            JSONObject settings;
            try{settings=state(c).optJSONObject("settings");}catch(Exception e){settings=null;}
            if(settings==null)settings=new JSONObject();
            Calendar now=Calendar.getInstance();
            boolean quiet=quietMinute(settings,now.get(Calendar.HOUR_OF_DAY)*60+now.get(Calendar.MINUTE));
            if(quiet)return result.put("ok",false).put("message","当前处于夜间静默时段，未发送测试提醒；请在允许时段测试或调整静默时间。");
            Intent openIntent=new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("openTab","settings");
            PendingIntent open=PendingIntent.getActivity(c,TEST_NOTIFICATION_ID,openIntent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            String text="安装自检：请确认手机是否显示通知、响铃或振动。点击返回设置。";
            Notification.Builder notification=new Notification.Builder(c,CHANNEL)
                .setSmallIcon(local.dailymotion.R.drawable.ic_motion).setContentTitle("每日动一动 · 测试提醒")
                .setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
                .setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE)
                .setLocalOnly(true).setContentIntent(open).setAutoCancel(true).setTimeoutAfter(10*MINUTE);
            manager.notify(TEST_NOTIFICATION_ID,notification.build());
            String message="已将测试通知交给系统，实际显示、声音和振动请在手机确认，仍受系统通知渠道、静音和勿扰设置控制。";
            return result.put("ok",true).put("message",message+"这次测试不计入每日次数，也不会修改计划或提醒开关。");
        }catch(SecurityException e) {
            try{return result.put("ok",false).put("message","系统未允许发送通知，或权限刚被撤销。请检查通知权限后重试。");}catch(Exception ignored){return result;}
        }catch(Exception e) {
            try{return result.put("ok",false).put("message","未能向系统提交测试通知，请检查通知设置后重试。");}catch(Exception ignored){return result;}
        }
    }
    private static String signature(JSONObject settings,int kind) {
        return baseMinutes(settings,kind)+":"+bounded(settings,"reminderIntervalMinutes",30,15,180)+":"+bounded(settings,"reminderMaxCount",3,1,5)+":"+settings.optString("quietStart","22:30")+":"+settings.optString("quietEnd","07:00");
    }
    public static synchronized void schedule(Context c) { schedule(c,false); }
    public static synchronized void schedule(Context c,boolean clockChanged) {
        ensureChannel(c);
        try {
            JSONObject data=state(c),settings=data.getJSONObject("settings");
            if(!settings.optBoolean("reminders",false)){cancel(c,1);cancel(c,2);return;}
            for(int kind:new int[]{1,2})scheduleKind(c,data,settings,kind,clockChanged);
        } catch(Exception e) { cancel(c,1);cancel(c,2); }
    }
    private static void scheduleKind(Context c,JSONObject data,JSONObject settings,int kind,boolean clockChanged) {
        // Old backups can contain a check inside quiet hours. Pause only that check instead of moving its goal to another date.
        if(quietMinute(settings,baseMinutes(settings,kind))){cancel(c,kind);return;}
        long now=System.currentTimeMillis();String today=date(now),sig=signature(settings,kind);SharedPreferences prefs=tracking(c);
        boolean needs=pending(data,kind,now),wasPending=prefs.getBoolean("wasPending_"+kind,needs);
        prefs.edit().putBoolean("wasPending_"+kind,needs).apply();
        int count=today.equals(prefs.getString("countDay_"+kind,""))?prefs.getInt("count_"+kind,0):0;
        int cap=bounded(settings,"reminderMaxCount",3,1,5);
        long existing=prefs.getLong("next_"+kind,0);String target=prefs.getString("target_"+kind,"");
        boolean existingValid=!clockChanged&&sig.equals(prefs.getString("signature_"+kind,""))&&existing>0&&target.compareTo(today)>=0;
        if(prefs.getBoolean("blocked_"+kind,false)&&c.getSystemService(NotificationManager.class).areNotificationsEnabled()) {
            NotificationChannel channel=c.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL);
            if(channel!=null&&channel.getImportance()!=NotificationManager.IMPORTANCE_NONE){prefs.edit().putBoolean("blocked_"+kind,false).apply();existingValid=false;}
        }
        if(needs&&!wasPending)existingValid=false;
        if(!needs||count>=cap) {
            c.getSystemService(NotificationManager.class).cancel(kind);
            long next=allowedTime(atTime(nextDay(now),baseMinutes(settings,kind)),settings);
            setNext(c,kind,next,sig);return;
        }
        if(existingValid){setNext(c,kind,quietSafeCheck(Math.max(now+1000,existing),settings,kind),sig);return;}
        long initial=atTime(now,baseMinutes(settings,kind));
        // Enabling or restoring late in the day gets one catch-up check, still subject to quiet hours and the cap.
        setNext(c,kind,quietSafeCheck(Math.max(now+1000,initial),settings,kind),sig);
    }
    private static void afterCheck(Context c,JSONObject data,JSONObject settings,int kind,long now) {
        SharedPreferences prefs=tracking(c);String today=date(now);int cap=bounded(settings,"reminderMaxCount",3,1,5);
        int count=today.equals(prefs.getString("countDay_"+kind,""))?prefs.getInt("count_"+kind,0):0;
        long next;
        if(pending(data,kind,now)&&count<cap&&!prefs.getBoolean("blocked_"+kind,false)) {
            next=allowedTime(now+bounded(settings,"reminderIntervalMinutes",30,15,180)*MINUTE,settings);
            // A follow-up crossing midnight becomes the next day's normal daily check.
            if(!date(next).equals(today))next=allowedTime(atTime(nextDay(now),baseMinutes(settings,kind)),settings);
        } else next=allowedTime(atTime(nextDay(now),baseMinutes(settings,kind)),settings);
        setNext(c,kind,next,signature(settings,kind));
    }
    @Override public void onReceive(Context c,Intent intent) {
        int kind=intent.getIntExtra("kind",1);if(kind!=1&&kind!=2)return;
        synchronized(ReminderReceiver.class) {
            try {
                JSONObject data=state(c),settings=data.getJSONObject("settings");
                if(!settings.optBoolean("reminders",false)){cancel(c,kind);return;}
                if(quietMinute(settings,baseMinutes(settings,kind))){cancel(c,kind);return;}
                long now=System.currentTimeMillis();String today=date(now),eventDay=intent.getStringExtra("day");
                if(eventDay!=null&&!eventDay.equals(today)){scheduleKind(c,data,settings,kind,false);return;}
                SharedPreferences prefs=tracking(c);
                if(SNOOZE.equals(intent.getAction())) {
                    c.getSystemService(NotificationManager.class).cancel(kind);afterCheck(c,data,settings,kind,now);return;
                }
                prefs.edit().remove("next_"+kind).remove("target_"+kind).apply();
                if(!pending(data,kind,now)){c.getSystemService(NotificationManager.class).cancel(kind);afterCheck(c,data,settings,kind,now);return;}
                long allowed=quietSafeCheck(now,settings,kind);
                if(allowed>now+1000){setNext(c,kind,allowed,signature(settings,kind));return;}
                int count=today.equals(prefs.getString("countDay_"+kind,""))?prefs.getInt("count_"+kind,0):0;
                int cap=bounded(settings,"reminderMaxCount",3,1,5);
                if(count<cap) {
                    ensureChannel(c);NotificationManager notifications=c.getSystemService(NotificationManager.class);
                    NotificationChannel channel=notifications.getNotificationChannel(CHANNEL);
                    if(notifications.areNotificationsEnabled()&&channel!=null&&channel.getImportance()!=NotificationManager.IMPORTANCE_NONE) {
                        int sent=count+1;
                        Intent openIntent=new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("openTab",kind==1?"training":"food");
                        PendingIntent open=PendingIntent.getActivity(c,kind,openIntent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                        String text=notificationText(data,settings,kind,now);
                        Notification.Builder notification=new Notification.Builder(c,CHANNEL).setSmallIcon(local.dailymotion.R.drawable.ic_motion).setContentTitle("每日目标待完成 · "+sent+"/"+cap).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setAutoCancel(true).addAction(new Notification.Action.Builder(null,"打开记录",open).build());
                        if(sent<cap) {
                            int interval=bounded(settings,"reminderIntervalMinutes",30,15,180);
                            Intent snoozeIntent=new Intent(c,ReminderReceiver.class).setAction(SNOOZE).putExtra("kind",kind).putExtra("day",today);
                            PendingIntent snooze=PendingIntent.getBroadcast(c,100+kind,snoozeIntent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                            notification.addAction(new Notification.Action.Builder(null,interval+"分钟后提醒",snooze).build());
                        }
                        try {
                            notifications.notify(kind,notification.build());
                            prefs.edit().putString("countDay_"+kind,today).putInt("count_"+kind,sent).putBoolean("blocked_"+kind,false).apply();
                        } catch(SecurityException e) { prefs.edit().putBoolean("blocked_"+kind,true).apply(); }
                    } else {
                        // No retry storm while the system has disabled notifications; next day or a settings change can retry.
                        prefs.edit().putBoolean("blocked_"+kind,true).apply();
                    }
                }
                afterCheck(c,data,settings,kind,now);
            }catch(Exception e) {
                android.util.Log.w("DailyMotion","Reminder could not be delivered",e);
            }
        }
    }
}

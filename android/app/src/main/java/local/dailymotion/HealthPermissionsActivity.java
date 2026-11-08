package local.dailymotion;

import android.app.Activity;
import android.os.Bundle;
import android.widget.ScrollView;
import android.widget.TextView;

/** System-accessible health permission rationale, served entirely from the APK. */
public final class HealthPermissionsActivity extends Activity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        TextView text=new TextView(this);text.setTextSize(17);int pad=(int)(24*getResources().getDisplayMetrics().density);text.setPadding(pad,pad,pad,pad);
        text.setText("每日动一动 · 健康数据说明\n\n"
            +"本机同步是可选功能，需要当前手机提供 Health Connect 服务。华为或其他未提供该服务的手机仍可使用手动记录；本应用不要求安装 Google 服务。\n\n"
            +"得到你的允许后，本应用只读取 WHOOP 分享到 Health Connect 的最近 7 天睡眠与运动记录，并按来源包过滤。不会读取其他应用的记录，不会写入或修改 Health Connect。\n\n"
            +"读取的记录仅缓存在本机，用于展示睡眠和运动参考。此功能不会把健康记录上传到服务器，也不包含 WHOOP 的恢复分数、strain、HRV 或连续实时心率。\n\n"
            +"本机读取不要求 WHOOP 开发者密钥。若你另外配置可选的 WHOOP API 服务，属于另一项明确授权的连接功能。\n\n"
            +"你可随时在系统 Health Connect 权限设置中撤销本应用的睡眠和运动读取权限，或在本应用清除本机同步缓存。同步失败不会影响打卡和饮食记录。\n\n"
            +"数据用于个人记录与回顾，不提供医疗诊断。\n\n可使用系统返回键关闭本说明。");
        ScrollView scroll=new ScrollView(this);scroll.addView(text);setContentView(scroll);
    }
}

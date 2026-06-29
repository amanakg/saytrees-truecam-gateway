| funName | Method | type | value | description |
|:-------------------------------------:|:----------:|:--------:|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------:|:-----------------------------------------------------------------------------------:|
| SmartDetect.Enabled | get/set | bool | true/false | Detecting the main switch |
| SmartDetect.Human.Enabled | get/set | bool | true/false | Humanoid detection switch |
| SmartDetect.Human.DrwBox | get/set | bool | true/false | Humanoid frame switch |
| PTZ.EnableMT | get/set | bool | true/false | Mobile tracking |
| SmartDetect.DetectSch | get/set | string | [{"Weekday":"0,1,2,3,4,5,6","BeginTime":"00:00:00","EndTime":"23:59:59"},{"Weekday":"0,1,2,3,4,5,6","BeginTime":"00:00:00","EndTime":"23:59:59"},{"Weekday":"0,1,2,3,4,5,6","BeginTime":"00:00:00","EndTime":"23:59:59"},{"Weekday":"0,1,2,3,4,5,6","BeginTime":"00:00:00","EndTime":"23:59:59"}] | Schedule |
| Video.Input[0].DetectArea.FixedGrid | get/set | string | [4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295,4294967295] | Motion detection area setting |
| Alarm.AlarmSound.Enabled | get/set | bool | true/false | Audible alarm |
| Alarm.Enabled | get/set | bool | true/false | Alarm master switch |
| Audio.Output.AlarmVolume | get/set | int | 68 | Alarm volume |
| Alarm.AlarmSound.Mode | get/set | string | 'Default'/'Custom' | Alarm sound type |
| Alarm.AlarmWhiteLight.Enabled | get/set | bool | true/false | Light alarm |
| Alarm.MsgToApp.Enabled | get/set | bool | true/false | Alarm message pop-up switch |
| Alarm.MsgToApp.Sch | get/set | string | [{'Weekday': '0,1,2,3,4,5,6', 'BeginTime': '00:00:00', 'EndTime': '23:59:59'}, {'Weekday': '', 'BeginTime': '', 'EndTime': ''}, {'Weekday': '', 'BeginTime': '', 'EndTime': ''}, {'Weekday': '', 'BeginTime': '', 'EndTime': ''}] | Alarm message pop-up schedule |
| Record.RecordTriggers.Continuous | get/set | bool | true/false | Time recording switch |
| Record.Stream | get/set | string | 'Sub'/'Main' | Video stream |
| Audio.Input[0].Enabled | get/set | bool | true/false | Audio input switch |
| Record.Sch | get/set | string | [{"Weekday":"0,1,2,3,4","BeginTime":"00:00:00","EndTime":"03:00:00"},{"Weekday":"0,1,2,3,4,5,6","BeginTime":"04:00:00","EndTime":"06:00:00"},{"Weekday":"0,1,2,3,4,5,6","BeginTime":"07:00:00","EndTime":"09:00:00"},{"Weekday":"0,1,2,3,4,5,6","BeginTime":"10:00:00","EndTime":"12:00:00"}] | Number of recording schedules |
| LightCtl.NightMode | get/set | string | 'Auto'/'Light'/'Smart'/'DayLight'/'Night' | Lamp control mode |
| System.PrivateMode.Enabled | get/set | bool | true/false | Privacy mode switch |
| Audio.Output.Volume | get/set | int | 68 | Audio output volume |
| PTZ.Cruise | get/set | string | 'None'/'AllRound'/'Preset' | Ptz cruise type |
| R.PTZ.Control | Action | json | {"Cmd": "SelfCheck", "Arg": 0, "Speed": 6} | PTZ Calibration |
| System.LedEnable | get/set | bool | true/false | Indicator light switch |
| System.PromptSoundEn | get/set | bool | true/false | Tone switch |
| R.Sync.Stat.NetWork | Action | | | Temporary information synchronization of device network (synchronous acquisition) |
| R.APInfoGet | Action | | | Ap hotspot information acquisition |
| Protocol.OnvifServer.Enabled | get/set | bool | true/false | Onvif switch |
| User.List | get/set | string | [{"Auth":{"Backup":true,"Live":true,"PTZ":true,"Playback":true,"Setting":true},"Enabled":true,"User":"admin","Password":"123"},{"Auth":{"Backup":true,"Live":true,"PTZ":true,"Playback":true,"Setting":true},"Enabled":true,"User":"admin2","Password":"aaa"},{"Auth":{"Backup":true,"Live":true,"PTZ":true,"Playback":true,"Setting":true},"Enabled":true,"User":"admin3","Password":"111"},{"Auth":{"Backup":true,"Live":true,"PTZ":true,"Playback":true,"Setting":true},"Enabled":true,"User":"admin4","Password":"abc"}] | Number of users |
| System.Time.TimeUtc | get/set | int | 0 | Time (recorded before each soft restart) |
| System.Time.TimeZone | get/set | int | 800 | Time zone |
| System.Time.Dst | get/set | string | {"EnableDst":false,"Country":"Default","Offset":60,"Week":[{"Type":"Start","Month":3,"Week":2,"Weekday":0,"Hour":2,"Minute":0},{"Type":"End","Month":11,"Week":1,"Weekday":0,"Hour":2,"Minute":0}]} | Daylight saving time |
| R.Sync.Stat.TF | Action | | | Temporary information synchronization of device tf card |
| R.TFManager | Action | string | {"Operate": "format"} | Tf card operation |
| System.Alexa | get/set | bool | true/false | Does it support alexa |
| Stat.DeviceInfo.DevName | get | | | Equipment name (complete machine model) |
| Stat.DeviceInfo.DevSoftVer | get | | | Device software version |
| Stat.DeviceInfo.DevMagic | get | | | Device magic |
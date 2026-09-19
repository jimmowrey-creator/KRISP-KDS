'use strict';
window.krispUpdateStatus=function(text){document.getElementById('update-status').textContent=text;};
document.getElementById('check-updates').onclick=function(){
 if(window.KrispUpdater)window.KrispUpdater.check();
 else window.krispUpdateStatus('Install the updater-enabled KRISP APK to check for updates here.');
};

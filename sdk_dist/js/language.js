/**
 * cookie
 */
function setCookie(c_name, value, expiredays) {
  var exdate = new Date();
  exdate.setDate(exdate.getDate() + expiredays);
  document.cookie = c_name + "=" + escape(value) + ((expiredays == null) ? "" : ";expires=" + exdate.toGMTString());
}
function getCookie(c_name) {
  var that = this;
  if (document.cookie.length > 0) {
    //cookie， -1
    c_start = document.cookie.indexOf(c_name + "=")
    if (c_start != -1) {
      //cookie
      c_start = c_start + c_name.length + 1;
      //";"
      c_end = document.cookie.indexOf(";", c_start);

      if (c_end == -1) {
        c_end = document.cookie.length;
      }
      //substring()
      return unescape(document.cookie.substring(c_start, c_end))
    }
  }
  return ""
}
/**
 * 
 * @return {string} 
 */
var getNavLanguage = function () {
  if (navigator.appName == "Netscape") {
    var navLanguage = navigator.language;
    // -_  ，
    return navLanguage.replace(/[-]/g, "_");
  }
  return false;
}

// 
var i18nLanguage = '';
// 
var webLanguage = ['en_US'];

// i18n
var execI18n = function () {
  // cookie
  if (getCookie("languageType")) {
    // i18nLanguage = getCookie("languageType")
    i18nLanguage = 'en_US'
    // console.log('cooKie--->', getCookie("languageType"))
  } else if (getNavLanguage() && webLanguage.indexOf(getNavLanguage()) >= 0) {
    // 
    // ，
    i18nLanguage = getNavLanguage()
    // console.log('--->', getNavLanguage())
  } else {
    // 
    i18nLanguage = 'en_US'
  }
  /*  i18n */
  if ($.i18n == undefined) {
    console.log("i18n js ")
    return false;
  };
  if (i18nLanguage === "undefined") {
    i18nLanguage = "en_US"
  }
  console.log("i18nLanguage", i18nLanguage);
  // i18n
  jQuery.i18n.properties({
    name: 'messages',  //
    path: 'i18n/',     //
    mode: 'map',       //Map
    language: i18nLanguage,
    callback: function () {//
      console.log();
      var insertEle = $(".i18n");
      //   console.log(".i18n ...");
      insertEle.each(function () {
        // i18n name 
        $(this).html($.i18n.prop($(this).attr('name')));
      });
      //   console.log("");
    }
  });
}

// 
$(function () {
  // 
  execI18n();
  // 
  $("#language option[value=" + i18nLanguage + "]").attr("selected", true);
  var language = $("#language").children('option:selected').val()
  // setCookie("languageType", language, 1);
  // 
  $("#language").on('change', function () {
    var language = $(this).children('option:selected').val()
    // console.log('language-->', language);
    // cookie；，，
    // setCookie("languageType", language, 1);
    execI18n();
  });
});

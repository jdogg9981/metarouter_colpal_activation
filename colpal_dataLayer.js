//console.log("[MR] - Begin MR cookie inspection...");
var event_SFDC = new CustomEvent("_mr_datalayerupdate");
var _mrTester = {};

//Storing the functionality for cookie reading in global variable.
window._mrFunctions = window._mrFunctions || {
    getCookie: function (name) {
        var cookies = document.cookie.split('; ');
        for (var i = 0; i < cookies.length; i++) {
            var cookieParts = cookies[i].split('=');
            var cookieName = cookieParts[0];
            var cookieValue = cookieParts.slice(1).join('='); // Handle cases where '=' exists in the value
            if (cookieName === name) {
                return cookieValue;
            }
        }
        return false;
    },
    "identifierListing": ['ajs_anonymous_id', '_fbp', '_ga', '_ga_TZJTZ24Z5E'],
    "identityGraph": {},
    updateDataLayer: function () {
        //console.log("[MR] - Updating the Data Layer...");
        //console.log(window._mrFunctions.identityGraph);
        dataLayer.push({
            metaRouter: {
                mrid: (window._mrFunctions.identityGraph.ajs_anonymous_id != undefined) ? window._mrFunctions.identityGraph.ajs_anonymous_id : "",
                sfAnonymousID: "",
                fbp: (window._mrFunctions.identityGraph._fbp != undefined) ? window._mrFunctions.identityGraph._fbp : "",
                fbc: (window._mrFunctions.identityGraph._fbc != undefined) ? window._mrFunctions.identityGraph._fbc : "",
                ga: (window._mrFunctions.identityGraph._ga != undefined) ? window._mrFunctions.identityGraph._ga : "",
                ga_session: (window._mrFunctions.identityGraph._ga_TZJTZ24Z5E != undefined) ? window._mrFunctions.identityGraph._ga_TZJTZ24Z5E : "",
                wbraid: "",
                dclid: (window._mrFunctions.identityGraph._dclid != undefined) ? window._mrFunctions.identityGraph._dclid : "",
                gclid: (window._mrFunctions.identityGraph._gclid != undefined) ? window._mrFunctions.identityGraph._gclid : ""
            }
        });
        //Clear the cookie out for good measure
        document.cookie = "_mr_syncInitialized=false;path=/;";
        //console.log("[MR] - Done loading the DataLayer...");
        clearTimeout(_mr_count_timeout);
    }
};

var _mr_count_timeout = setTimeout(function () {
    //console.log("[MR] - Timeout Check");
    document.cookie = "_mr_syncInitialized=true;path=/;";
}, 2000);

var _mr_completed = false;

var _mr_count_interval = setInterval(function(){
    //console.log("[MR] - Interval Check");
    var cookieVal = window._mrFunctions.getCookie("_mr_syncInitialized");
    //console.log("[MR] - Cookie Value: " + cookieVal);
    if (cookieVal != false && cookieVal !== "false") {
        //console.log("[MR] - Sync complete - ");
        clearInterval(_mr_count_interval);
        setTimeout(function(){window._mrFunctions.updateDataLayer();},1000);
        return;
    } else {
        //console.log("[MR] - Scroll through cookies");
        //console.log(window._mrFunctions.identifierListing);
        if (window._mrFunctions.identifierListing.length == 0) {
            document.cookie = "_mr_syncInitialized=true;path=/;";
        } else {
            var nextRoundIDs = [];
            for (key in window._mrFunctions.identifierListing) {
                var element = window._mrFunctions.identifierListing[key];
                var oID = window._mrFunctions.getCookie(element);
                if (oID != false) {
                    //console.log("[MR] - Identifier found: " + element + " - " + oID);
                    //Add the value of the cookie to the identity graph object.
                    window._mrFunctions.identityGraph[element] = oID;
                } else {
                    nextRoundIDs.push(window._mrFunctions.identifierListing[key]);//set that array to be removed.
                }
            }
            window._mrFunctions.identifierListing = nextRoundIDs;
        }
        return true;
    }
}, 100);
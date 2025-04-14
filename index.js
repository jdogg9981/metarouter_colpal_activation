const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');

const analyticsAdmin = require('@google-analytics/admin');

const fetch = require('node-fetch');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const util = require('util');

//Configuration for MetaRouter routing
const writeKey = "tuhogar_colpal";
const const_batchSize = 10000; //Batch size for MetaRouter endpoint
const MR_Endpoint = "https://colgate-prod1-blue.gcp-uscentral1.mr-in.com/v1/batch"; //MetaRouter endpoint

//FB Configuration Elements
const FB_AccessToken = "EAAV96AA1uAsBO70KItdnWCiasXw69NmEnMEhZBhBx3KZAapdaZBqj7iTZCbsrA4ZCcFXz6mjCyn9hMZBO0HY2jiNqgHkj8DaVWrA5zpy46IUUkGisxBtSiZBrZBXcczGiSswmbvUgG0WNveJvGAPZAFJFodvyAoZArfNvdpZBU8a6ILZBONmZAToqCPQISQ1x";
const fb_accountID = "186259606766605"; //Facebook account ID
const fb_pixelID = "1169011487499965"; //Facebook pixel ID
const fb_trackedEventName = "add_to_audience";

//Google Analytics 4 config
const parent = "properties/366993005";

//Test Variables
const debug = false;
const testAudName = "JW-TestAudience ABC";

const audienceRule = {
    "inclusions": {
        "operator": "or",
        "rules": [
            {
                "event_sources": [
                    {
                        "type": "pixel",
                        "id": fb_pixelID
                    }
                ],
                "retention_seconds": 2592000,
                "filter": {
                    "operator": "and",
                    "filters": [
                        {
                            "field": "event",
                            "operator": "eq",
                            "value": fb_trackedEventName
                        }
                    ]
                }
            }
        ]
    }
};

//Startup Google Client
var analyticsAdminClient = new analyticsAdmin.AnalyticsAdminServiceClient({
    keyFilename: "MR_key.json"
});

//Utility Functions
function replaceHyphenAndSpace(input) {
    return input.replace(/[- ]/g, "_");
}

const colDebug = {
    "log": function (message) {
        if (debug == true) {
            console.log(message);
        }
    }
}

//Function to read the contents of the GCS file
async function readFileFunction(cloudEvent) {
    try {
        var message = cloudEvent;
        var storage = new Storage();
        var bucket = storage.bucket(message.message.attributes.bucketId);
        var file = bucket.file(message.message.attributes.objectId);

        // Read the file contents
        const [fileContents] = await file.download();

        colDebug.log("File contents - " + fileContents.toString());

        return fileContents.toString();
    } catch (error) {
        console.log("Error - " + JSON.stringify(error));
        return error;
    }
}

//Function to make the HTTPS request to MR for event processing
// Function to make HTTPS POST request
const makeHttpPostRequest = async (url, oPayload, authToken, sMethod) => {
    try {
        colDebug.log("Request Destination - " + url);
        colDebug.log("Request Payload - " + oPayload);

        var oHeader = {};
        var oRequest = {};

        if (authToken != "") {
            oHeader = {
                'Authorization': "Bearer " + authToken,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        } else {
            oHeader = {
                'Content-Type': 'application/json'
            }
        }


        if (sMethod == "POST") {
            oRequest = {
                method: sMethod,
                headers: oHeader,
                body: oPayload
            }
        } else {
            oRequest = {
                method: sMethod,
                headers: oHeader
            }
        }

        colDebug.log("Request Object - " + JSON.stringify(oRequest));

        var response = await fetch(url, oRequest);

        if (!response.ok) {
            console.log("Response Error - " + response.toString());
            return false;
        }

        var oResponse = await response.json();

        colDebug.log("Response - " + JSON.stringify(oResponse));

        return oResponse;
    } catch (error) {
        console.log("Error - " + error.toString());
        return false;
    }
};

//Function to parse the CSV file contents
const parseCSV = (csvData) => {
    const lines = csvData.split('\n');
    const headers = lines[0].split(',');
    const jsonData = [];

    for (let i = 1; i < lines.length; i++) {
        const obj = {};
        const currentline = lines[i].split(',');

        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = currentline[j];
        }
        jsonData.push(obj);
    }

    colDebug.log("Parsed CSV JSON - " + JSON.stringify(jsonData));

    return jsonData;
}

//Function to find the CSV file
const findCSVFile = async (bucketId, segmentName) => {
    try {
        const storage = new Storage();
        const [files] = await storage.bucket(bucketId).getFiles();

        colDebug.log('Files in bucket:');
        if (debug == true) {
            files.forEach(file => {
                colDebug.log(file.name);
            });
        }

        // Filter files with "test" and ".csv" in the filename
        const matchingFiles = files.filter(file =>
            file.name.includes(segmentName + "_Export_GCS_") && file.name.endsWith('.csv')
        );

        if (matchingFiles.length > 0) {
            colDebug.log('Matching file(s) found:', matchingFiles.map(file => file.name));
            return matchingFiles.map(file => file.name); // Return the matching filenames
        } else {
            console.log('No matching files found.');
            return false;
        }
    } catch (error) {
        console.error('Error listing files:', error);
        return false;
    }
}

const createPayload = (csvFileContent_raw, segmentName) => {
    var aBatches = []; //Storing the chunked batch calls...
    var batchObject = {
        "batch": [],
        "sentAt": new Date().toISOString(),
        "writeKey": writeKey
    };

    //Create a formatted payload to send to MetaRouter
    var jsonContent = parseCSV(csvFileContent_raw);
    var iCurrentBatchSize = 0;

    for (var x = 0; x < jsonContent.length; x++) {
        var element = jsonContent[x];
        if (iCurrentBatchSize < const_batchSize) {
            console.log("Current element - " + JSON.stringify(element));
            if (element["Id"] != undefined) {
                //Critical payload elements
                var formattedEvent = {};
                formattedEvent["integrations"] = {};
                formattedEvent["event"] = fb_trackedEventName;
                formattedEvent["anonymousId"] = element["Id"];
                formattedEvent["type"] = "track";
                formattedEvent["context"] = {};
                formattedEvent["context"]["consent"] = {
                    "explicit": true,
                    "optOut": {
                        "0000": false
                    }
                };
                formattedEvent["context"]["providers"] = {
                    "facebookTag": {
                        "_fbp": element["fbp"],
                        "_fpc": element["fpc"]
                    },
                    "googleTag": {
                        "data": {
                            "ga": element["ga"]
                        }
                    },
                    "theTradeDesk": {
                        "ttd_id": element["ttd_id"]
                    }
                };

                formattedEvent["context"]["userAgent"] = element["User_Agent"];

                formattedEvent["properties"] = {};
                formattedEvent["properties"]["segmentName"] = segmentName;
                batchObject.batch.push(formattedEvent);
            }

            colDebug.log("Current batch - " + JSON.stringify(batchObject));

            iCurrentBatchSize++;
        } else {//Reached the maximum batch size. Reset the batch object and counter.
            iCurrentBatchSize = 0;
            aBatches.push(batchObject);
            batchObject = {
                "batch": [],
                "sentAt": new Date().toISOString(),
                "writeKey": writeKey
            };
        }
    };
    aBatches.push(batchObject);

    colDebug.log("Final batch - " + JSON.stringify(aBatches));

    return aBatches;
}

//Facebook Audience Creation
const createAudience_fb = async (segmentName) => {
    var url = 'https://graph.facebook.com/v22.0/act_' + fb_accountID + '/customaudiences';
    var data = {
        name: segmentName,
        rule: JSON.stringify(audienceRule)
    };

    try {
        var oPayload = new URLSearchParams(data).toString();

        colDebug.log("Paylod for FB - " + oPayload);

        var response = await makeHttpPostRequest(url, oPayload, FB_AccessToken, "POST");
        colDebug.log('FB Create Audience Response:', response);
        return response;
    } catch (error) {
        console.error('Error creating audience:', error);
        return false;
    }
};

const checkAudience_fb = async (segmentName) => {
    var url = 'https://graph.facebook.com/v22.0/act_' + fb_accountID + '/customaudiences?fields=name,rule';
    var data = {};

    try {
        var oPayload = new URLSearchParams(data).toString();
        var oResponse = await makeHttpPostRequest(url, oPayload, FB_AccessToken, "GET");

        colDebug.log('FB Check Audience Response:', oResponse);

        for (let index = 0; index < oResponse.data.length; index++) {
            const element = oResponse.data[index];
            if (element.name == segmentName) {
                colDebug.log("Audience already exists - " + JSON.stringify(element));
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error('Error finding audience:', error);
        return "error";
    }
};


const createAudience_google = async (audienceName) => {
    try {
        var audience = {
            "displayName": audienceName,
            "description": "Rule for adding users to audience " + audienceName,
            "membershipDurationDays": 30,
            "adsPersonalizationEnabled": true,
            "eventTrigger": {
                "eventName": audienceName,
                "logCondition": "AUDIENCE_JOINED"
            },
            "exclusionDurationMode": "AUDIENCE_EXCLUSION_DURATION_MODE_UNSPECIFIED",
            "filterClauses": [
                {
                    "clauseType": "INCLUDE",
                    "filter": "simpleFilter",
                    "simpleFilter":
                    {
                        "scope": "AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS",
                        "filterExpression": {
                            "scope": "AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS",
                            "expr": "andGroup",
                            "andGroup": {
                                "filterExpressions": [{
                                    "expr": "orGroup",
                                    "orGroup": {
                                        "filterExpressions": [{
                                            "expr": "dimensionOrMetricFilter",
                                            "dimensionOrMetricFilter": {
                                                "atAnyPointInTime": true,
                                                "fieldName": "eventName",
                                                "inAnyNDayPeriod": 0,
                                                "oneFilter": "stringFilter",
                                                "stringFilter": {
                                                    "caseSensitive": true,
                                                    "matchType": "EXACT",
                                                    "value": audienceName
                                                }
                                            }
                                        }]
                                    }
                                }]
                            }
                        }
                    }
                }
            ]
        };

        var request = {
            "parent": parent,
            "audience": audience
        }

        colDebug.log("Google audience create request - " + JSON.stringify(request));

        var response = await analyticsAdminClient.createAudience(request);

        colDebug.log("Google audience create Response - " + JSON.stringify(response));

        return true;
    } catch (error) {
        console.log("Error on Audience creation for Google - " + audienceName + " - " + JSON.stringify(error));
        return false
    }
}

const checkAudience_google = async (audienceName) => {
    try {
        var foundAudience = false;

        var request = {
            parent: parent
        }

        var iterable = await analyticsAdminClient.listAudiencesAsync(request);

        for await (const response of iterable) {
            colDebug.log("Audience - " + JSON.stringify(response));
            if (response.displayName == audienceName) {
                foundAudience = true;
                break;
            }
        }
        colDebug.log("Audience found - " + audienceName);

        return foundAudience;
    } catch (error) {
        console.log("Error on Audience check for Google - " + audienceName + " - " + JSON.stringify(error));
        return "error";
    }
}

//Function to send the payload to MetaRouter
const sendPayloadToMetaRouter = async (aBatchedPayload) => {
    try {

        colDebug.log("String of batched payload - " + JSON.stringify(aBatchedPayload));

        aBatchedPayload.forEach(async (batchObject) => {
            // Make the HTTPS POST request
            await makeHttpPostRequest(MR_Endpoint, JSON.stringify(batchObject), "", "POST");
        });
        return true;
    } catch (error) {
        console.error('Error sending request:', error);
        return false;
    }
}

// Register a CloudEvent callback with the Functions Framework that will
// be executed when the Pub/Sub trigger topic receives a message.
functions.cloudEvent('receiveFiles', async function (cloudEvent) {
    //Check if the right file to read
    if (cloudEvent.message.attributes.objectId.indexOf("metadata.json") == -1) {
        return false;
    }

    //Read the file contents
    var response = await readFileFunction(cloudEvent);

    //Check that there are updated records in the set
    var fileDetails = JSON.parse(response);
    var iRecordSet = fileDetails.activatedRecordCount;

    if (iRecordSet == 0) {
        console.log("No records to process");
        return false;
    }

    //Store the name of the segment
    var segmentName = fileDetails.name;

    //Search for the .csv file
    var csvObjectId = await findCSVFile(cloudEvent.message.attributes.bucketId, fileDetails.name);

    if (csvObjectId == false) {
        console.log("No .csv file for that segment found...");
        return {
            status: 'success',
            message: "No .csv file for that segment found..."
        };
    }

    //Now read the contents of the .csv file and output a formatted event payload
    var CSVDetails = {
        "message": {
            "attributes": {
                "bucketId": cloudEvent.message.attributes.bucketId,
                "objectId": csvObjectId[0]
            }
        }
    };

    var csvFileContent_raw = await readFileFunction(CSVDetails);

    //Check if the audience exists in FB
    var audienceExists_fb = await checkAudience_fb(segmentName);
    if (audienceExists_fb == "error") {
        console.log("Error checking audience");
        return {
            status: 'success',
            message: "Error checking audience in facebook."
        };
    }

    //Check if the audience exists in Google
    var sAudienceName = replaceHyphenAndSpace(testAudName);//Google does not like event names and audience names to have hyphens
    var audienceExists_google = await checkAudience_google(sAudienceName);

    if (audienceExists_google == "error") {
        console.log("Error checking audience");
        return {
            status: 'success',
            message: "Error checking audience in google."
        };
    }

    if (audienceExists_fb == false) {
        console.log("Audience does not exist. Creating audience...");
        var audienceResponse = await createAudience_fb(segmentName);
        if (audienceResponse == false) {
            console.log("Error creating audience");
            return {
                status: 'success',
                message: "Error creating audience"
            };
        }
    } else {
        console.log("Audience already exists");
    }

    if (audienceExists_google == false) {
        console.log("Audience does not exist. Creating audience...");
        var audienceResponse = await createAudience_google(segmentName);
        if (audienceResponse == false) {
            console.log("Error creating audience");
            return {
                status: 'success',
                message: "Error creating audience"
            };
        }
    }

    //Create Payload
    var oPayload = createPayload(csvFileContent_raw, segmentName);

    //Send Payload to MetaRouter
    try {
        var response = await sendPayloadToMetaRouter(oPayload);
        return {
            status: 'success',
            message: "Yay everything worked..."
        };
    } catch (error) {
        console.log("Error - " + JSON.stringify(error));
        return {
            status: 'success',
            message: "Error sending payload to MetaRouter - " + JSON.stringify(error)
        };
    }
});
// ==========================================================
// GPS TRACKING FOR QGIS2WEB
// Version 3 - OFFLINE FIRST
// GPS + IndexedDB + GeoJSON + CSV + ZIP
// ==========================================================

(function () {

    "use strict";

    // ======================================================
    // SETTINGS
    // ======================================================

    // CURRENT TEST INTERVAL = 10 seconds
    var TRACK_INTERVAL = 10 * 1000;

    // FOR FINAL FIELD USE, change to:
    // var TRACK_INTERVAL = 5 * 60 * 1000;

    var DB_NAME = "QGIS2WebGPSTracks";
    var DB_VERSION = 2;
    var STORE_NAME = "tracks";

    // ======================================================
    // TRACK STATE
    // ======================================================

    var gpsTracking = {

        active: false,

        timer: null,

        gpsRequestInProgress: false,

        layer: null,

        path: null,

        button: null,

        downloadButton: null,

        statusPanel: null,

        trackId: null,

        startTime: null,

        endTime: null,

        points: [],

        totalDistance: 0,

        lastSavePromise: Promise.resolve(),

        lastGPSStatus: "Waiting",

        lastGPSMessage: ""

    };

    // ======================================================
    // CHECK MAP
    // ======================================================

    if (typeof map === "undefined") {

        console.error(
            "QGIS2Web map was not found."
        );

        return;
    }

    // ======================================================
    // CREATE GPS LAYER
    // ======================================================

    gpsTracking.layer =
        L.featureGroup().addTo(map);

    // ======================================================
    // CREATE TRACK LINE
    // ======================================================

    gpsTracking.path =
        L.polyline(
            [],
            {
                color: "#006400",
                weight: 4,
                opacity: 0.85
            }
        ).addTo(map);

    // ======================================================
    // INDEXEDDB
    // ======================================================

    function openDatabase() {

        return new Promise(
            function (resolve, reject) {

                var request =
                    indexedDB.open(
                        DB_NAME,
                        DB_VERSION
                    );

                request.onupgradeneeded =
                    function (event) {

                        var db =
                            event.target.result;

                        if (
                            !db.objectStoreNames.contains(
                                STORE_NAME
                            )
                        ) {

                            db.createObjectStore(
                                STORE_NAME,
                                {
                                    keyPath: "id"
                                }
                            );
                        }
                    };

                request.onsuccess =
                    function () {

                        resolve(
                            request.result
                        );
                    };

                request.onerror =
                    function () {

                        reject(
                            request.error
                        );
                    };
            }
        );
    }

    // ======================================================
    // SAVE TRACK LOCALLY
    // ======================================================

    function saveTrack() {

        if (!gpsTracking.trackId) {

            return Promise.resolve();
        }

        /*
         * Queue saves so two IndexedDB writes
         * cannot overwrite each other.
         */

        gpsTracking.lastSavePromise =
            gpsTracking.lastSavePromise.then(
                function () {

                    return new Promise(
                        async function (
                            resolve,
                            reject
                        ) {

                            try {

                                var db =
                                    await openDatabase();

                                var track = {

                                    id:
                                        gpsTracking.trackId,

                                    startTime:
                                        gpsTracking.startTime,

                                    endTime:
                                        gpsTracking.endTime,

                                    points:
                                        gpsTracking.points.slice(),

                                    totalDistance:
                                        gpsTracking.totalDistance,

                                    active:
                                        gpsTracking.active,

                                    updatedAt:
                                        new Date().toISOString()
                                };

                                var transaction =
                                    db.transaction(
                                        [STORE_NAME],
                                        "readwrite"
                                    );

                                var store =
                                    transaction.objectStore(
                                        STORE_NAME
                                    );

                                store.put(track);

                                transaction.oncomplete =
                                    function () {

                                        db.close();

                                        resolve();
                                    };

                                transaction.onerror =
                                    function () {

                                        db.close();

                                        reject(
                                            transaction.error
                                        );
                                    };

                            }
                            catch (error) {

                                console.error(
                                    "IndexedDB save error:",
                                    error
                                );

                                reject(error);
                            }
                        }
                    );
                }
            ).catch(
                function (error) {

                    console.error(
                        "GPS local save failed:",
                        error
                    );
                }
            );

        return gpsTracking.lastSavePromise;
    }

    // ======================================================
    // DISTANCE
    // ======================================================

    function calculateDistance(
        lat1,
        lon1,
        lat2,
        lon2
    ) {

        var R = 6371000;

        var dLat =
            (lat2 - lat1) *
            Math.PI / 180;

        var dLon =
            (lon2 - lon1) *
            Math.PI / 180;

        var a =
            Math.sin(dLat / 2) *
            Math.sin(dLat / 2) +

            Math.cos(
                lat1 * Math.PI / 180
            ) *

            Math.cos(
                lat2 * Math.PI / 180
            ) *

            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);

        var c =
            2 *
            Math.atan2(
                Math.sqrt(a),
                Math.sqrt(1 - a)
            );

        return R * c;
    }

    // ======================================================
    // FORMAT DISTANCE
    // ======================================================

    function formatDistance(meters) {

        if (meters < 1000) {

            return (
                meters.toFixed(0) +
                " m"
            );
        }

        return (
            (meters / 1000).toFixed(2) +
            " km"
        );
    }

    // ======================================================
    // FORMAT DURATION
    // ======================================================

    function formatDuration(
        milliseconds
    ) {

        if (
            !milliseconds ||
            milliseconds < 0
        ) {

            return "00:00:00";
        }

        var totalSeconds =
            Math.floor(
                milliseconds / 1000
            );

        var hours =
            Math.floor(
                totalSeconds / 3600
            );

        var minutes =
            Math.floor(
                (totalSeconds % 3600) / 60
            );

        var seconds =
            totalSeconds % 60;

        return (
            String(hours).padStart(2, "0") +
            ":" +
            String(minutes).padStart(2, "0") +
            ":" +
            String(seconds).padStart(2, "0")
        );
    }

    // ======================================================
    // CREATE TRACK ID
    // ======================================================

    function createTrackId() {

        var now = new Date();

        var date =
            now.toISOString()
                .replace(
                    /[:.]/g,
                    "-"
                );

        return (
            "GPS_Track_" +
            date
        );
    }

    // ======================================================
    // CREATE GPS POINT
    // ======================================================

    function createGPSPoint(
        position
    ) {

        var latitude =
            position.coords.latitude;

        var longitude =
            position.coords.longitude;

        var accuracy =
            position.coords.accuracy;

        var timestamp =
            new Date(
                position.timestamp ||
                Date.now()
            ).toISOString();

        return {

            id:
                gpsTracking.points.length + 1,

            latitude:
                latitude,

            longitude:
                longitude,

            accuracy:
                accuracy,

            altitude:
                position.coords.altitude,

            altitudeAccuracy:
                position.coords.altitudeAccuracy,

            speed:
                position.coords.speed,

            heading:
                position.coords.heading,

            timestamp:
                timestamp
        };
    }

    // ======================================================
    // ADD POINT TO MAP
    // ======================================================

    function addPointToMap(
        point
    ) {

        var marker =
            L.circleMarker(
                [
                    point.latitude,
                    point.longitude
                ],
                {
                    radius: 7,

                    color: "#006400",

                    fillColor: "#00ff00",

                    fillOpacity: 0.8,

                    weight: 2
                }
            );

        marker.bindPopup(

            "<b>GPS Point " +
            point.id +
            "</b><br>" +

            "Latitude: " +
            point.latitude.toFixed(6) +

            "<br>" +

            "Longitude: " +
            point.longitude.toFixed(6) +

            "<br>" +

            "Accuracy: " +
            (
                point.accuracy !== null
                    ? point.accuracy.toFixed(1)
                    : "N/A"
            ) +

            " m<br>" +

            "Time: " +

            new Date(
                point.timestamp
            ).toLocaleString()
        );

        gpsTracking.layer.addLayer(
            marker
        );
    }

    // ======================================================
    // UPDATE TRACK LINE
    // ======================================================

    function updatePath() {

        var coordinates =
            gpsTracking.points.map(
                function (point) {

                    return [
                        point.latitude,
                        point.longitude
                    ];
                }
            );

        gpsTracking.path.setLatLngs(
            coordinates
        );
    }

    // ======================================================
    // ADD GPS POSITION
    // ======================================================

    async function addGPSPosition(
        position
    ) {

        if (!gpsTracking.active) {

            return;
        }

        var point =
            createGPSPoint(
                position
            );

        // --------------------------------------------------
        // DISTANCE
        // --------------------------------------------------

        if (
            gpsTracking.points.length > 0
        ) {

            var previous =
                gpsTracking.points[
                    gpsTracking.points.length - 1
                ];

            var distance =
                calculateDistance(

                    previous.latitude,
                    previous.longitude,

                    point.latitude,
                    point.longitude
                );

            /*
             * Ignore impossible GPS jumps.
             *
             * This prevents a bad GPS fix from
             * creating a huge artificial distance.
             */

            if (
                distance >= 0 &&
                distance < 1000
            ) {

                gpsTracking.totalDistance +=
                    distance;
            }
        }

        // --------------------------------------------------
        // STORE POINT
        // --------------------------------------------------

        gpsTracking.points.push(
            point
        );

        // --------------------------------------------------
        // DRAW POINT
        // --------------------------------------------------

        addPointToMap(
            point
        );

        // --------------------------------------------------
        // DRAW TRACK
        // --------------------------------------------------

        updatePath();

        // --------------------------------------------------
        // MOVE MAP
        // --------------------------------------------------

        map.setView(
            [
                point.latitude,
                point.longitude
            ],
            Math.max(
                map.getZoom(),
                17
            )
        );

        // --------------------------------------------------
        // SAVE IMMEDIATELY
        // --------------------------------------------------

        await saveTrack();

        // --------------------------------------------------
        // STATUS
        // --------------------------------------------------

        gpsTracking.lastGPSStatus =
            "GPS OK";

        gpsTracking.lastGPSMessage =
            "Last point saved locally";

        updateTrackingStatus();

        console.log(
            "GPS point recorded and saved locally:",
            point
        );
    }

    // ======================================================
    // GPS ERROR
    // ======================================================

    function handleGPSError(
        error
    ) {

        gpsTracking.lastGPSStatus =
            "GPS Error";

        gpsTracking.lastGPSMessage =
            error.message ||
            "Unable to obtain GPS position";

        updateTrackingStatus();

        console.error(
            "GPS error:",
            error
        );
    }

    // ======================================================
    // REQUEST GPS
    // ======================================================

    function getGPSLocation() {

        if (
            !gpsTracking.active
        ) {

            return;
        }

        if (
            !navigator.geolocation
        ) {

            alert(
                "GPS / Geolocation is not supported by this browser."
            );

            stopGPSTracking();

            return;
        }

        /*
         * Prevent overlapping GPS requests.
         */

        if (
            gpsTracking.gpsRequestInProgress
        ) {

            return;
        }

        gpsTracking.gpsRequestInProgress =
            true;

        gpsTracking.lastGPSStatus =
            "Getting GPS...";

        updateTrackingStatus();

        navigator.geolocation.getCurrentPosition(

            function (position) {

                gpsTracking.gpsRequestInProgress =
                    false;

                addGPSPosition(
                    position
                );
            },

            function (error) {

                gpsTracking.gpsRequestInProgress =
                    false;

                handleGPSError(
                    error
                );
            },

            {

                enableHighAccuracy:
                    true,

                timeout:
                    30000,

                maximumAge:
                    0
            }
        );
    }

    // ======================================================
    // SCHEDULE NEXT GPS READING
    // ======================================================

    function scheduleNextGPS() {

        if (
            !gpsTracking.active
        ) {

            return;
        }

        if (
            gpsTracking.timer
        ) {

            clearTimeout(
                gpsTracking.timer
            );
        }

        gpsTracking.timer =
            setTimeout(
                function () {

                    getGPSLocation();

                    scheduleNextGPS();

                },
                TRACK_INTERVAL
            );
    }

    // ======================================================
    // START TRACKING
    // ======================================================

    async function startGPSTracking() {

        if (
            !navigator.geolocation
        ) {

            alert(
                "GPS / Geolocation is not supported by this browser."
            );

            return;
        }

        if (
            gpsTracking.active
        ) {

            return;
        }

        // --------------------------------------------------
        // NEW TRACK
        // --------------------------------------------------

        gpsTracking.active =
            true;

        gpsTracking.trackId =
            createTrackId();

        gpsTracking.startTime =
            new Date().toISOString();

        gpsTracking.endTime =
            null;

        gpsTracking.points =
            [];

        gpsTracking.totalDistance =
            0;

        gpsTracking.lastGPSStatus =
            "Starting";

        gpsTracking.lastGPSMessage =
            "";

        // --------------------------------------------------
        // CLEAR MAP
        // --------------------------------------------------

        gpsTracking.layer.clearLayers();

        gpsTracking.path.setLatLngs(
            []
        );

        // --------------------------------------------------
        // BUTTON
        // --------------------------------------------------

        if (
            gpsTracking.button
        ) {

            gpsTracking.button.innerHTML =
                "⏹️";

            gpsTracking.button.title =
                "Stop GPS Tracking";
        }

        // --------------------------------------------------
        // SAVE EMPTY TRACK FIRST
        // --------------------------------------------------

        await saveTrack();

        // --------------------------------------------------
        // FIRST GPS POINT
        // --------------------------------------------------

        getGPSLocation();

        // --------------------------------------------------
        // SCHEDULE
        // --------------------------------------------------

        scheduleNextGPS();

        updateTrackingStatus();

        console.log(
            "GPS tracking started:",
            gpsTracking.trackId
        );
    }

    // ======================================================
    // STOP TRACKING
    // ======================================================

    async function stopGPSTracking() {

        if (
            !gpsTracking.active
        ) {

            return;
        }

        gpsTracking.active =
            false;

        // --------------------------------------------------
        // STOP TIMER
        // --------------------------------------------------

        if (
            gpsTracking.timer
        ) {

            clearTimeout(
                gpsTracking.timer
            );

            gpsTracking.timer =
                null;
        }

        // --------------------------------------------------
        // END TIME
        // --------------------------------------------------

        gpsTracking.endTime =
            new Date().toISOString();

        // --------------------------------------------------
        // FINAL LOCAL SAVE
        // --------------------------------------------------

        await saveTrack();

        // --------------------------------------------------
        // BUTTON
        // --------------------------------------------------

        if (
            gpsTracking.button
        ) {

            gpsTracking.button.innerHTML =
                "📍";

            gpsTracking.button.title =
                "Start GPS Tracking";
        }

        gpsTracking.lastGPSStatus =
            "Stopped";

        gpsTracking.lastGPSMessage =
            "Track saved locally";

        updateTrackingStatus();

        console.log(
            "GPS tracking stopped."
        );

        alert(

            "Tracking stopped.\n\n" +

            "Points: " +
            gpsTracking.points.length +

            "\nDistance: " +

            formatDistance(
                gpsTracking.totalDistance
            )
        );
    }

    // ======================================================
    // STATUS PANEL
    // ======================================================

    var StatusControl =
        L.Control.extend({

            options: {
                position:
                    "topright"
            },

            onAdd:
                function () {

                    var container =
                        L.DomUtil.create(
                            "div",
                            "gps-status-panel"
                        );

                    container.style.background =
                        "rgba(255,255,255,0.95)";

                    container.style.padding =
                        "8px 10px";

                    container.style.borderRadius =
                        "6px";

                    container.style.fontSize =
                        "13px";

                    container.style.lineHeight =
                        "1.4";

                    container.style.minWidth =
                        "190px";

                    container.style.boxShadow =
                        "0 1px 5px rgba(0,0,0,0.3)";

                    container.innerHTML =
                        "<b>GPS Tracking</b><br>" +
                        "Status: Ready";

                    gpsTracking.statusPanel =
                        container;

                    L.DomEvent.disableClickPropagation(
                        container
                    );

                    return container;
                }
        });

    map.addControl(
        new StatusControl()
    );

    // ======================================================
    // UPDATE STATUS
    // ======================================================

    function updateTrackingStatus() {

        if (
            !gpsTracking.statusPanel
        ) {

            return;
        }

        var trackingStatus =
            gpsTracking.active
                ? "🟢 Recording"
                : "⚪ Stopped";

        var internetStatus =
            navigator.onLine
                ? "🟢 Online"
                : "🔴 Offline";

        var duration =
            gpsTracking.startTime

                ? formatDuration(

                    (
                        gpsTracking.endTime

                            ? new Date(
                                gpsTracking.endTime
                            )

                            : new Date()

                    ) -

                    new Date(
                        gpsTracking.startTime
                    )
                )

                : "00:00:00";

        gpsTracking.statusPanel.innerHTML =

            "<b>GPS Tracking</b><br>" +

            "Status: " +
            trackingStatus +

            "<br>" +

            "Internet: " +
            internetStatus +

            "<br>" +

            "GPS: " +
            gpsTracking.lastGPSStatus +

            "<br>" +

            "Points: " +
            gpsTracking.points.length +

            "<br>" +

            "Distance: " +
            formatDistance(
                gpsTracking.totalDistance
            ) +

            "<br>" +

            "Duration: " +
            duration;
    }

    // ======================================================
    // ONLINE / OFFLINE EVENTS
    // ======================================================

    window.addEventListener(
        "online",
        function () {

            console.log(
                "Internet connection restored."
            );

            updateTrackingStatus();
        }
    );

    window.addEventListener(
        "offline",
        function () {

            console.warn(
                "Internet connection lost. GPS tracking continues locally."
            );

            updateTrackingStatus();
        }
    );

    // ======================================================
    // GPS CONTROL
    // ======================================================

    var GPSControl =
        L.Control.extend({

            options: {
                position:
                    "topleft"
            },

            onAdd:
                function () {

                    var container =
                        L.DomUtil.create(
                            "div",
                            "leaflet-bar leaflet-control"
                        );

                    var button =
                        L.DomUtil.create(
                            "a",
                            "",
                            container
                        );

                    button.href =
                        "#";

                    button.innerHTML =
                        "📍";

                    button.title =
                        "Start GPS Tracking";

                    button.style.fontSize =
                        "18px";

                    button.style.textAlign =
                        "center";

                    button.style.textDecoration =
                        "none";

                    L.DomEvent.disableClickPropagation(
                        container
                    );

                    L.DomEvent.on(
                        button,
                        "click",
                        function (event) {

                            L.DomEvent.stop(
                                event
                            );

                            if (
                                gpsTracking.active
                            ) {

                                stopGPSTracking();

                            }
                            else {

                                startGPSTracking();
                            }
                        }
                    );

                    gpsTracking.button =
                        button;

                    return container;
                }
        });

    map.addControl(
        new GPSControl()
    );

    // ======================================================
    // DOWNLOAD CONTROL
    // ======================================================

    var DownloadControl =
        L.Control.extend({

            options: {
                position:
                    "topleft"
            },

            onAdd:
                function () {

                    var container =
                        L.DomUtil.create(
                            "div",
                            "leaflet-bar leaflet-control"
                        );

                    var button =
                        L.DomUtil.create(
                            "a",
                            "",
                            container
                        );

                    button.href =
                        "#";

                    button.innerHTML =
                        "💾";

                    button.title =
                        "Download GPS Track";

                    button.style.fontSize =
                        "18px";

                    button.style.textAlign =
                        "center";

                    L.DomEvent.disableClickPropagation(
                        container
                    );

                    L.DomEvent.on(
                        button,
                        "click",
                        function (event) {

                            L.DomEvent.stop(
                                event
                            );

                            downloadCurrentTrack();
                        }
                    );

                    gpsTracking.downloadButton =
                        button;

                    return container;
                }
        });

    map.addControl(
        new DownloadControl()
    );

    // ======================================================
    // GEOJSON - POINTS
    // ======================================================

    function createPointsGeoJSON() {

        var features =
            gpsTracking.points.map(
                function (point) {

                    return {

                        type:
                            "Feature",

                        properties: {

                            id:
                                point.id,

                            latitude:
                                point.latitude,

                            longitude:
                                point.longitude,

                            accuracy:
                                point.accuracy,

                            altitude:
                                point.altitude,

                            altitude_accuracy:
                                point.altitudeAccuracy,

                            speed:
                                point.speed,

                            heading:
                                point.heading,

                            timestamp:
                                point.timestamp
                        },

                        geometry: {

                            type:
                                "Point",

                            coordinates: [

                                point.longitude,

                                point.latitude
                            ]
                        }
                    };
                }
            );

        return {

            type:
                "FeatureCollection",

            features:
                features
        };
    }

    // ======================================================
    // GEOJSON - TRACK
    // ======================================================

    function createTrackGeoJSON() {

        var coordinates =
            gpsTracking.points.map(
                function (point) {

                    return [

                        point.longitude,

                        point.latitude
                    ];
                }
            );

        var geometry =
            null;

        if (
            coordinates.length >= 2
        ) {

            geometry = {

                type:
                    "LineString",

                coordinates:
                    coordinates
            };
        }

        return {

            type:
                "FeatureCollection",

            features: [

                {

                    type:
                        "Feature",

                    properties: {

                        track_id:
                            gpsTracking.trackId,

                        start_time:
                            gpsTracking.startTime,

                        end_time:
                            gpsTracking.endTime,

                        points:
                            gpsTracking.points.length,

                        distance_m:
                            gpsTracking.totalDistance
                    },

                    geometry:
                        geometry
                }
            ]
        };
    }

    // ======================================================
    // CSV
    // ======================================================

    function createCSV() {

        var csv =
            "id,latitude,longitude,accuracy_m,altitude_m,speed_mps,heading_deg,timestamp\n";

        gpsTracking.points.forEach(
            function (point) {

                csv +=

                    point.id + "," +

                    point.latitude + "," +

                    point.longitude + "," +

                    (
                        point.accuracy !== null
                            ? point.accuracy
                            : ""
                    ) + "," +

                    (
                        point.altitude !== null
                            ? point.altitude
                            : ""
                    ) + "," +

                    (
                        point.speed !== null
                            ? point.speed
                            : ""
                    ) + "," +

                    (
                        point.heading !== null
                            ? point.heading
                            : ""
                    ) + "," +

                    point.timestamp +

                    "\n";
            }
        );

        return csv;
    }

    // ======================================================
    // README
    // ======================================================

    function createREADME() {

        return (

            "GPS TRACK EXPORT\n" +
            "================\n\n" +

            "Track ID: " +
            gpsTracking.trackId +
            "\n" +

            "Start time: " +
            gpsTracking.startTime +
            "\n" +

            "End time: " +
            (
                gpsTracking.endTime ||
                "Not stopped"
            ) +
            "\n" +

            "Number of points: " +
            gpsTracking.points.length +
            "\n" +

            "Distance: " +
            gpsTracking.totalDistance.toFixed(2) +
            " meters\n\n" +

            "TRACKING MODE\n" +
            "-------------\n" +

            "GPS points were saved locally using IndexedDB.\n" +

            "Internet connection was not required for local storage.\n\n" +

            "FILES\n" +
            "-----\n" +

            "track.geojson\n" +
            "GPS track as LineString.\n\n" +

            "points.geojson\n" +
            "Every GPS location as a Point.\n\n" +

            "points.csv\n" +
            "GPS coordinates and attributes.\n\n" +

            "QGIS\n" +
            "----\n" +

            "Open track.geojson and points.geojson in QGIS.\n" +

            "Coordinate system: WGS84 / EPSG:4326.\n"
        );
    }

    // ======================================================
    // UTF-8
    // ======================================================

    function textToBytes(text) {

        return new TextEncoder().encode(
            text
        );
    }

    // ======================================================
    // CRC32
    // ======================================================

    var crcTable = null;

    function makeCRCTable() {

        var table = [];

        for (
            var n = 0;
            n < 256;
            n++
        ) {

            var c = n;

            for (
                var k = 0;
                k < 8;
                k++
            ) {

                c =
                    (
                        c & 1
                    )

                        ? 0xEDB88320 ^
                          (c >>> 1)

                        : c >>> 1;
            }

            table[n] =
                c >>> 0;
        }

        return table;
    }

    function crc32(bytes) {

        if (!crcTable) {

            crcTable =
                makeCRCTable();
        }

        var crc =
            0xFFFFFFFF;

        for (
            var i = 0;
            i < bytes.length;
            i++
        ) {

            crc =
                crcTable[
                    (crc ^ bytes[i]) &
                    0xFF
                ] ^
                (crc >>> 8);
        }

        return (
            crc ^
            0xFFFFFFFF
        ) >>> 0;
    }

    // ======================================================
    // WRITE UINT16
    // ======================================================

    function writeUint16(
        array,
        offset,
        value
    ) {

        array[offset] =
            value & 0xFF;

        array[offset + 1] =
            (value >>> 8) & 0xFF;
    }

    // ======================================================
    // WRITE UINT32
    // ======================================================

    function writeUint32(
        array,
        offset,
        value
    ) {

        array[offset] =
            value & 0xFF;

        array[offset + 1] =
            (value >>> 8) & 0xFF;

        array[offset + 2] =
            (value >>> 16) & 0xFF;

        array[offset + 3] =
            (value >>> 24) & 0xFF;
    }

    // ======================================================
    // CONCAT ARRAYS
    // ======================================================

    function concatUint8Arrays(
        arrays
    ) {

        var total = 0;

        arrays.forEach(
            function (array) {

                total +=
                    array.length;
            }
        );

        var result =
            new Uint8Array(
                total
            );

        var offset = 0;

        arrays.forEach(
            function (array) {

                result.set(
                    array,
                    offset
                );

                offset +=
                    array.length;
            }
        );

        return result;
    }

    // ======================================================
    // CREATE ZIP
    // ======================================================

    function createZIP(
        files
    ) {

        var localParts = [];

        var centralParts = [];

        var offset = 0;

        files.forEach(
            function (file) {

                var nameBytes =
                    textToBytes(
                        file.name
                    );

                var dataBytes =
                    textToBytes(
                        file.content
                    );

                var crc =
                    crc32(
                        dataBytes
                    );

                // ------------------------------------------
                // LOCAL HEADER
                // ------------------------------------------

                var localHeader =
                    new Uint8Array(
                        30
                    );

                writeUint32(
                    localHeader,
                    0,
                    0x04034b50
                );

                writeUint16(
                    localHeader,
                    4,
                    20
                );

                writeUint16(
                    localHeader,
                    6,
                    0x0800
                );

                writeUint16(
                    localHeader,
                    8,
                    0
                );

                writeUint16(
                    localHeader,
                    10,
                    0
                );

                writeUint16(
                    localHeader,
                    12,
                    0
                );

                writeUint32(
                    localHeader,
                    14,
                    crc
                );

                writeUint32(
                    localHeader,
                    18,
                    dataBytes.length
                );

                writeUint32(
                    localHeader,
                    22,
                    dataBytes.length
                );

                writeUint16(
                    localHeader,
                    26,
                    nameBytes.length
                );

                writeUint16(
                    localHeader,
                    28,
                    0
                );

                localParts.push(
                    localHeader,
                    nameBytes,
                    dataBytes
                );

                // ------------------------------------------
                // CENTRAL DIRECTORY
                // ------------------------------------------

                var centralHeader =
                    new Uint8Array(
                        46
                    );

                writeUint32(
                    centralHeader,
                    0,
                    0x02014b50
                );

                writeUint16(
                    centralHeader,
                    4,
                    20
                );

                writeUint16(
                    centralHeader,
                    6,
                    20
                );

                writeUint16(
                    centralHeader,
                    8,
                    0x0800
                );

                writeUint16(
                    centralHeader,
                    10,
                    0
                );

                writeUint16(
                    centralHeader,
                    12,
                    0
                );

                writeUint16(
                    centralHeader,
                    14,
                    0
                );

                writeUint32(
                    centralHeader,
                    16,
                    crc
                );

                writeUint32(
                    centralHeader,
                    20,
                    dataBytes.length
                );

                writeUint32(
                    centralHeader,
                    24,
                    dataBytes.length
                );

                writeUint16(
                    centralHeader,
                    28,
                    nameBytes.length
                );

                writeUint16(
                    centralHeader,
                    30,
                    0
                );

                writeUint16(
                    centralHeader,
                    32,
                    0
                );

                writeUint16(
                    centralHeader,
                    34,
                    0
                );

                writeUint16(
                    centralHeader,
                    36,
                    0
                );

                writeUint32(
                    centralHeader,
                    38,
                    0
                );

                writeUint32(
                    centralHeader,
                    42,
                    offset
                );

                centralParts.push(
                    centralHeader,
                    nameBytes
                );

                offset +=

                    localHeader.length +

                    nameBytes.length +

                    dataBytes.length;
            }
        );

        var localDirectory =
            concatUint8Arrays(
                localParts
            );

        var centralDirectory =
            concatUint8Arrays(
                centralParts
            );

        // ----------------------------------------------
        // END OF CENTRAL DIRECTORY
        // ----------------------------------------------

        var end =
            new Uint8Array(
                22
            );

        writeUint32(
            end,
            0,
            0x06054b50
        );

        writeUint16(
            end,
            4,
            0
        );

        writeUint16(
            end,
            6,
            0
        );

        writeUint16(
            end,
            8,
            files.length
        );

        writeUint16(
            end,
            10,
            files.length
        );

        writeUint32(
            end,
            12,
            centralDirectory.length
        );

        writeUint32(
            end,
            16,
            localDirectory.length
        );

        writeUint16(
            end,
            20,
            0
        );

        return concatUint8Arrays(
            [
                localDirectory,
                centralDirectory,
                end
            ]
        );
    }

    // ======================================================
    // DOWNLOAD CURRENT TRACK
    // ======================================================

    function downloadCurrentTrack() {

        if (
            !gpsTracking.points ||
            gpsTracking.points.length === 0
        ) {

            alert(
                "There are no GPS points to download yet."
            );

            return;
        }

        var trackGeoJSON =
            JSON.stringify(
                createTrackGeoJSON(),
                null,
                2
            );

        var pointsGeoJSON =
            JSON.stringify(
                createPointsGeoJSON(),
                null,
                2
            );

        var csv =
            createCSV();

        var readme =
            createREADME();

        var zip =
            createZIP(

                [

                    {
                        name:
                            "track.geojson",

                        content:
                            trackGeoJSON
                    },

                    {
                        name:
                            "points.geojson",

                        content:
                            pointsGeoJSON
                    },

                    {
                        name:
                            "points.csv",

                        content:
                            csv
                    },

                    {
                        name:
                            "README.txt",

                        content:
                            readme
                    }
                ]
            );

        var blob =
            new Blob(
                [zip],
                {
                    type:
                        "application/zip"
                }
            );

        var url =
            URL.createObjectURL(
                blob
            );

        var link =
            document.createElement(
                "a"
            );

        link.href =
            url;

        link.download =
            (
                gpsTracking.trackId ||
                "GPS_Track"
            ) +
            ".zip";

        document.body.appendChild(
            link
        );

        link.click();

        document.body.removeChild(
            link
        );

        setTimeout(
            function () {

                URL.revokeObjectURL(
                    url
                );

            },
            1000
        );

        console.log(
            "GPS track downloaded."
        );
    }

    // ======================================================
    // LOAD LAST TRACK
    // ======================================================

    async function loadLastTrack() {

        try {

            var db =
                await openDatabase();

            var tracks =
                await new Promise(
                    function (
                        resolve,
                        reject
                    ) {

                        var transaction =
                            db.transaction(
                                [STORE_NAME],
                                "readonly"
                            );

                        var store =
                            transaction.objectStore(
                                STORE_NAME
                            );

                        var request =
                            store.getAll();

                        request.onsuccess =
                            function () {

                                resolve(
                                    request.result
                                );
                            };

                        request.onerror =
                            function () {

                                reject(
                                    request.error
                                );
                            };
                    }
                );

            db.close();

            if (
                !tracks ||
                tracks.length === 0
            ) {

                return;
            }

            tracks.sort(
                function (a, b) {

                    return (

                        new Date(
                            b.updatedAt
                        ) -

                        new Date(
                            a.updatedAt
                        )
                    );
                }
            );

            var latest =
                tracks[0];

            // ------------------------------------------------
            // LOAD SAVED DATA
            // ------------------------------------------------

            gpsTracking.trackId =
                latest.id;

            gpsTracking.startTime =
                latest.startTime;

            gpsTracking.endTime =
                latest.endTime;

            gpsTracking.points =
                latest.points || [];

            gpsTracking.totalDistance =
                latest.totalDistance || 0;

            /*
             * Never automatically start GPS after
             * page reload.
             */

            gpsTracking.active =
                false;

            // ------------------------------------------------
            // REBUILD MAP
            // ------------------------------------------------

            gpsTracking.layer.clearLayers();

            gpsTracking.path.setLatLngs(
                []
            );

            gpsTracking.points.forEach(
                function (point) {

                    addPointToMap(
                        point
                    );
                }
            );

            updatePath();

            gpsTracking.lastGPSStatus =
                "Saved";

            gpsTracking.lastGPSMessage =
                "Previous track loaded locally";

            updateTrackingStatus();

            console.log(
                "Last GPS track loaded:",
                latest.id
            );

        }
        catch (error) {

            console.error(
                "Could not load saved track:",
                error
            );
        }
    }

    // ======================================================
    // UPDATE STATUS EVERY SECOND
    // ======================================================

    setInterval(
        function () {

            updateTrackingStatus();

        },
        1000
    );

    // ======================================================
    // INITIALIZE
    // ======================================================

    loadLastTrack();

    updateTrackingStatus();

    console.log(
        "GPS Tracking System v3 - OFFLINE FIRST loaded."
    );

})();

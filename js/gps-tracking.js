// ==========================================
// GPS TRACKING FOR QGIS2WEB
// ==========================================

var gpsTracking = {
    active: false,
    timer: null,
    marker: null,
    layer: null,
    interval: 10 * 1000 // 5 minutes
};

// Create a layer for GPS points
gpsTracking.layer = L.featureGroup().addTo(map);


// ------------------------------------------
// Create GPS control
// ------------------------------------------

var GPSControl = L.Control.extend({

    options: {
        position: 'topleft'
    },

    onAdd: function(map) {

        var container = L.DomUtil.create(
            'div',
            'leaflet-bar leaflet-control gps-control'
        );

        var button = L.DomUtil.create(
            'a',
            '',
            container
        );

        button.href = '#';
        button.title = 'Start GPS Tracking';
        button.innerHTML = '📍';

        L.DomEvent.disableClickPropagation(container);

        L.DomEvent.on(button, 'click', function(e) {

            L.DomEvent.stop(e);

            if (!gpsTracking.active) {
                startGPSTracking();
            } else {
                stopGPSTracking();
            }

        });

        gpsTracking.button = button;

        return container;
    }
});


// Add control to map
map.addControl(new GPSControl());


// ------------------------------------------
// Start GPS tracking
// ------------------------------------------

function startGPSTracking() {

    if (!navigator.geolocation) {

        alert(
            'GPS / Geolocation is not supported by this browser.'
        );

        return;
    }

    gpsTracking.active = true;

    gpsTracking.button.innerHTML = '⏹️';
    gpsTracking.button.title = 'Stop GPS Tracking';

    // Get first location immediately
    getGPSLocation();

    // Then every 5 minutes
    gpsTracking.timer = setInterval(
        getGPSLocation,
        gpsTracking.interval
    );

    console.log('GPS tracking started.');
}


// ------------------------------------------
// Stop GPS tracking
// ------------------------------------------

function stopGPSTracking() {

    gpsTracking.active = false;

    if (gpsTracking.timer) {

        clearInterval(gpsTracking.timer);

        gpsTracking.timer = null;
    }

    gpsTracking.button.innerHTML = '📍';
    gpsTracking.button.title = 'Start GPS Tracking';

    console.log('GPS tracking stopped.');
}


// ------------------------------------------
// Get GPS location
// ------------------------------------------

function getGPSLocation() {

    navigator.geolocation.getCurrentPosition(

        function(position) {

            var latitude = position.coords.latitude;
            var longitude = position.coords.longitude;
            var accuracy = position.coords.accuracy;

            var time = new Date();

            console.log(
                'GPS:',
                latitude,
                longitude,
                'Accuracy:',
                accuracy,
                'Time:',
                time
            );


            // ----------------------------------
            // Create GPS point
            // ----------------------------------

            var point = L.circleMarker(
                [latitude, longitude],
                {
                    radius: 7,
                    color: '#006400',
                    fillColor: '#00ff00',
                    fillOpacity: 0.8,
                    weight: 2
                }
            );


            // ----------------------------------
            // Popup information
            // ----------------------------------

            point.bindPopup(
                '<b>GPS Location</b><br>' +
                'Latitude: ' + latitude.toFixed(6) + '<br>' +
                'Longitude: ' + longitude.toFixed(6) + '<br>' +
                'Accuracy: ' + accuracy.toFixed(1) + ' m<br>' +
                'Time: ' + time.toLocaleString()
            );


            // Add point to map
            gpsTracking.layer.addLayer(point);


            // Move map to current location
            map.setView(
                [latitude, longitude],
                Math.max(map.getZoom(), 17)
            );


            // ----------------------------------
            // Optional: connect points
            // ----------------------------------

            updateGPSPath();

        },

        function(error) {

            console.error(
                'GPS error:',
                error.message
            );

            alert(
                'Unable to obtain GPS location: ' +
                error.message
            );

        },

        {
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 0
        }
    );
}


// ------------------------------------------
// Draw line connecting GPS points
// ------------------------------------------

var gpsPath = L.polyline(
    [],
    {
        color: '#006400',
        weight: 4
    }
).addTo(map);


function updateGPSPath() {

    var coordinates = [];

    gpsTracking.layer.eachLayer(
        function(layer) {

            var latlng = layer.getLatLng();

            coordinates.push([
                latlng.lat,
                latlng.lng
            ]);

        }
    );

    gpsPath.setLatLngs(coordinates);
}

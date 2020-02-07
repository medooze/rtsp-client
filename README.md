
# RTSP client library
Minimal rtsp signaling protocol only client library.

## Install

```
npm i --save rtsp-client
```

## Usage

```javascript
	const RTSPClient = require('rtsp-client');
```

## Example
```javascript
	//Create client
	const client = new RTSPClient();

	//Connect to url
	await client.connect("rtsp://server.url");

	//Get options
	const options = await client.options();

	//Describe
	const describe = await client.describe();

	//Dump SDP
	console.log(describe.body.plain);
```

## Author

Sergio Garcia Murillo @ Medooze

## License
MIT

const Net = require ('net')
const Url = require ('url');
const httpZ = require ('./http-z');
const WWWAuthenticate = require('www-authenticate');
const Emitter = require ('./Emitter');

class RTSPClient extends Emitter
{
	constructor()
	{
		super ();
		this.cseq = 1;
		this.transactions = {};
	
	}
	
	authenticate(username,password)
	{
		this.authenticator =  WWWAuthenticate(username,password);
	}

	connect (url)
	{
		if (this.socket)
			throw new Error ("already connecting");
		
		//parse url
		this.url = Url.parse(url);
			
		//Promise base
		return new Promise ((resolve,reject)=>{
			try {
				//Connect options
				const options = {
					host: this.url.hostname,
					port: this.url.port || 554,
				};
				//Create socket
				this.socket = Net.connect(options);
				//No delay
				this.socket.setNoDelay(true);

				this.socket.on("connect",()=>{
					//Emit
					this.emitter.emit("connected",this);
					//Resolve
					resolve();
				});
				
				this.socket.on("timeout",(e)=>{
					//Emit
					this.emitter.emit("timeout",this,e);
				});
				
				this.socket.on("error",(e)=>{
					//Reject
					reject(e);
					//Emit
					this.emitter.emit("error",this,e);
				});

				this.socket.on("data",(buffer)=>{
					const str = buffer.toString();
					//Parse data
					const response = httpZ.parse(str);
					//Get Cseq headers
					const cseqs = response.headers.find(header=>header.name.toLowerCase()=="cseq");
						
					//Try get it from headers or first in transaction queue
					const cseq = cseqs ? cseqs.values[0].value : Object.keys(this.transactions)[0];

					//Check
					if (!cseq)
						return console.error("cseq not found");

					//Get transaction
					const transaction = this.transactions[cseq];
					
					//Resolve transaction
					if (!transaction)
						return console.error("transaction not found");
					
					//Check response for authentication
					if (response.statusCode==401 && !transaction.authenticated && this.authenticator)
					{
						//Get www authentication challenge
						const headers = response.headers.find(header=>header.name.toLowerCase()=="www-authenticate");
						//Find digest
						for (let header of headers.values)
						{
							//Get method
							if (header.value.startsWith("Digest "))
							{
								//Add authntication header
								transaction.authenticated = this.authenticated = this.authenticator(header.value);
								//Remove any previous authentication header
								transaction.request.headers = transaction.request.headers.filter(header => header.name.toLowerCase()!="authorization");
								//Push it
								transaction.request.headers.push({
									name	: "Authorization",
									values	: [{value: this.authenticated.authorize(transaction.request.method,this.url.href)}]
								});
								//Serialize
								const str = httpZ.build(transaction.request);
								//Serialize and send
								this.socket.write(str,()=>{
									//Set ts 
									transaction.sent = new Date();
								});
								//End
								return;
							}
						}
						//Find basic
						for (let header of headers.values)
						{
							//Get method
							if (header.value.startsWith("Basic "))
							{
								//Add authntication header
								transaction.authenticated = this.authenticated = this.authenticator(header.value);
								//Remove any previous authentication header
								transaction.request.headers = transaction.request.headers.filter(header => header.name.toLowerCase()!="authorization");
								//Push it
								transaction.request.headers.push({
									name	: "Authorization",
									values	: [{value: this.authenticated.authorize(transaction.request.method,this.url.href)}]
								});
								//Serialize
								const str = httpZ.build(transaction.request);
								//Serialize and send
								this.socket.write(str,()=>{
									//Set ts 
									transaction.sent = new Date();
								});
								//End
								return;
							}
						}
					} 
					//Resolve it
					transaction.resolve(response);
					
					//Delete from transactions
					delete(this.transactions[cseq]);
				});
			} catch(e) {
				reject(e);
			}
		});
	}
	
	setTimeout(timeout)
	{
		//Store timeout
		this.timeout = timeout;
		//If we already have a socket
		if (this.socket)
			//Update it now
			this.socket.setTimeout(timeout);
	}

	
	setSession(sessionId) 
	{
		this.sessionId = sessionId;
	}
	
	getRemoteAddress()
	{
		return this.socket ? this.socket.remoteAddress : "0.0.0.0";
	}

	request (method, path, headers)
	{
		return new Promise((resolve,reject)=>{
			try{
				//Get cseq
				const cseq = this.cseq++;
				//Store resolve
				const transaction = this.transactions[cseq] = {
					ts	: new Date(),
					resolve : resolve,
					reject  : reject
				};
				//Create request
				const request = {
					method		: method,
					protocol	: 'RTSP',
					protocolVersion	: 'RTSP/1.0',
					host		: this.url.hostname,
					path		: path,
					params		: {p1: 'v1'},
					headers: [
						{ name : "CSeq"		, values : [{value: cseq}]},
						{ name : "User-Agent"	, values : [{value: "medooze-rtsp-client"}]}
					]
				};

				//Add headers
				for (const[key,val] of Object.entries(headers || {}))
					//Push it
					request.headers.push({
						name	: key,
						values	: [{value: val}]
					});
				//If We have been authenticated
				if (this.authenticated)
					//Push header
					request.headers.push({
						name	: "Authorization",
						values	: [{value: this.authenticated.authorize(request.method,this.url.href)}]
					});
				//Store request for authentication
				transaction.request = request;
				//Serialize
				const str = httpZ.build(request);
				//Serialize and send
				this.socket.write(str,()=>{
					//Set ts 
					transaction.sent = new Date();
				});
			} catch (e) {
				reject(e);
			}
			
		});
	}

	options ()
	{
		//Send options request
		return this.request("OPTIONS",this.url.href);
	}
	
	describe ()
	{
		//Send describe request
		return this.request("DESCRIBE",this.url.href, {
			"Accept"	: "application/sdp"
		});
	}
	
	setup(control,transport)
	{
		//Get url
		//If the presentation comprises only a single stream, the media-level "a=control:" attribute may be omitted altogether
		const setupUrl = control ? new Url.URL(control,this.url.href+"/") : new Url.URL(this.url.href);
		//Basic headers
		const headers = {
			"Transport" : transport
		};
		//If we have session id
		if (this.sessionId)
			headers["Session"] = this.sessionId;
		//Send request
		return this.request("SETUP", setupUrl.href, headers);
	}
	
	play(options)
	{
		//Check we have a session id
		if (!this.sessionId)
			//Error
			throw new Error("SessionId not set");
		//Basic headers
		const headers = {
			"Session": this.sessionId
		};
		//If we have range
		if (options && options.range)
			//Set header
			headers["Range"] = options.range;
		//Play request
		return this.request("PLAY", this.url.href, headers);
	}
	
	pause()
	{
		//Basic headers
		const headers = {
			"Session": this.sessionId
		};
		//Payse reques
		return this.request("PAUSE", this.url.href, headers);
	}
	
	getParameter()
	{
		//Basic headers
		const headers = {
			"Session": this.sessionId
		};
		//Payse reques
		return this.request("GET_PARAMETER", this.url.href, headers);
	}
	
	
	teardown()
	{
		//Basic headers
		const headers = {
			"Session": this.sessionId
		};
		//teardown requestt
		return this.request("TEARDOWN", this.url.href, headers);
	}
	
	close ()
	{
		//Check we are still opened
		if (!this.socket)
			return;
		
		//For each pending transaction
		for (const transaction of Object.values(this.transactions))
			//Reject it
			transaction.reject(new Error("RTSPClient is destroyed"));
		
		//Close socket
		this.socket.destroy();
		
		/**
		* RTSPClient closed event
		*
		* @name closed
		* @memberof AudioEncoder
		* @kind event
		* @argument {AudioEncoder} encoder
		*/
		this.emitter.emit("closed", this);
		
		//Stop emitter
		super.stop();
		
		//Null
		this.socket = null;
		this.transactions = null;
	}

}


module.exports = RTSPClient;

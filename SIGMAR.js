/* 
	Cognethos DataServer streaming interface version 3.0.0.49. 
	Copyright (c) 2006-2009 by Cognethos Pty Ltd. All rights reserved. 
	No unauthorised use, duplication or distribution allowed without prior consent from Cognethos Pty Ltd.
	http://www.cognethos.com
*/
/*
 * stream.js
 * CogStream 3
 */
//slob:prefixes=C_,v_,m_,LL_
//slob:namespaces=M,PC,PS

/*
 * Logging levels
 */
var LogLevel =
{
    ERROR       : 0,
	WARNING     : 1,
	INFORMATION : 2,
	TRACE       : 3,
	TRACE1      : 3,
	TRACE2      : 4,
	TRACE3      : 5
};

/*
 * Create a new cogstream object
 */
function createStream(v_window, v_params)
{
	var C_Copyright = "Copyright � Cognethos Pty Ltd, 2009. All rights reserved";

	/*
	 * Members
	 */
	var M = {};
	var PC = {}; 		// Proxy client access class
	var PS = {}; 		// Proxy server access class
	var v_pub = {}; 	// Public interface

	/*
	 * Connection status
	 */
	var C_STATE_DISCONNECTED = 0;
	var C_STATE_CONNECTING = 1;
	var C_STATE_CONNECTED = 2;

	/*
	 * Streaming mode
	 */
	var C_MODE_UNKNOWN = 0;
	var C_MODE_STREAMING = 2;
	var C_MODE_NONSTREAMING = 3;

	/*
	 * Browser types
	 */
	var C_BROWSER_UNKNOWN = 0;
	var C_BROWSER_FIREFOX = 1;
	var C_BROWSER_SAFARI = 2;
	var C_BROWSER_IE = 3;
	var C_BROWSER_CHROME = 4;
	
	/*
	 * Domain types
	 */
	var C_CONNECTION_LOCAL 		= 0; // host and dataserver are the same: data3.cognethos.com
	var C_CONNECTION_SUB   		= 1; // host and dataserver are on the same subdomain: www.cognethos.com and data3.cognethos.com. we can use direct script access by modifying 'document.domain'
	var C_CONNECTION_PCLIENT 	= 2; // host and dataserver are on differing domains: www.somecompany.com and data3.cognethos.com. A proxy client is used
	var C_CONNECTION_PSERVER 	= 3; // host and dataserver are on differing domains: A proxy server is being used (from xdframe.lp)
	
	/*
	 * Proxy Messages. Sent to server
	 */
	var C_MSG_DISCONNECT		= 1; 	// format: { type:C_MSG_DISCONNECT }
	var C_MSG_SEND				= 2; 	// format: { type:C_MSG_SEND, msgtype:"type", msghdr:"header", msgbody:"body" }
	
	/*
	 * Proxy Messages. Sent to client
	 */
	var C_MSG_ONLOADED			= 1; 	// format: { type:C_MSG_ONLOADED }
	var C_MSG_ONCONNECTED		= 2; 	// format: { type:C_MSG_ONCONNECTED }
	var C_MSG_ONDISCONNECTED	= 3;	// format: { type:C_MSG_ONDISCONNECTED }
	var C_MSG_ONMSG				= 4;	// format: { type:C_MSG_ONMSG, msgtype:"type", msghdr:"header", msgbody:"body" }
	
	var C_UNEXPECTED 			= "Unexpected";
	var C_BLANK_URL				= "about:blank";
	var C_SERVERS_COOKIE		= "CogStreamUsedServers";
	
	/*
	* Log Levels (redefined here for better obfuscation)
	*/
    var LL_ERROR        = LogLevel.ERROR;
	var LL_WARNING		= LogLevel.WARNING;
	var LL_INFORMATION	= LogLevel.INFORMATION;
	var LL_TRACE		= LogLevel.TRACE;
	var LL_TRACE1		= LogLevel.TRACE1;
	var LL_TRACE2		= LogLevel.TRACE2;
	var LL_TRACE3		= LogLevel.TRACE3;
	
	/*
	 * Initialisation
	 */
	M.init = function(v_window, v_params)
	{
                M.conncted = false ;
		// Save window and friends

		M.win = v_window;
		M.doc = v_window.document;
		M.params = v_params;
		M.detectBrowser();

		// If there are multiple servers specified, claim one.

		M.server = M.params.server || "";
		M.proxyHost = M.params._ph || "";
		M.serverAcquired = false;
		M.altServers = null;

		if(M.server.indexOf(",") != -1)
		{
			M.altServers = M.server.split(",");
			M.acquireServer();
		}

		M.detectConnectionType();

		// Initialise config
                
                M.lostStreamedData = "";
                M.MessageId = "";
		M.cfgHeartInterval = 5;
		M.cfgMaxMissedBeats = 2;
		M.cfgMaxRetries = 3;
		M.cfgStreamTimeout = 3;
		M.cfgFrameTimeout = 10;

		// Requests / timers. 
		// Created in connect, and freed in disconnect.

		M.cmdRequest = null;
		M.stmRequest = null;
		M.stmHeartTimer = 0;
                M.firstFlushTimer = 0;
		
		// Streaming IFrame state. These are created on demand, and never
		// freed. The iframeFile and iframeParent used for the IE htmlfile
		// implementation. We don't use them after creation, but need to
		// keep a reference to them, otherwise attempts to access the
		// iframe will fail with an 'access denied' error.

		M.iframe = null;
		M.iframeFile = null;
		M.iframeParent = null;
		M.sdframe = null; // subdomain Iframe (sdframe.lp)
		M.xdframe = null; // crossdomain Iframe (xdframe.lp)
		M.frameTimer = 0;
		M.connectTimer = 0;
		
		// Setup state

		M.resetState();

		// Build context for replies

		M.context = {};
		M.context.c = M.cmdChannel;
		M.context.h = M.cmdHeartbeat;
		M.context.r = M.cmdRefresh;
		M.context.q = M.cmdSequence;
		M.context.e = M.cmdError;
		M.context.m = M.cmdMsg;
		
		// Build a preamble string, for use in streaming iframes. The 
		// preamble sets the domain on the iframe if necessary (needed for 
		// IE, when in a subdomain), and calls setContext (_sc) to make the 
		// reply commands available to the iframe.

		M.preamble = "\"<html><body><script>";
		M.preamble += "document.domain='" + M.doc.domain + "';";
		M.preamble += "parent.stream._sc(this);";
		M.preamble += "</script>\"";
		
		// Set up proxy server callback funcs

		if(M.connectionType == C_CONNECTION_PSERVER)
		{
			M.params.onDisconnect = PS.onDisconnect;
			M.params.onConnected = PS.onConnected;
			M.params.onMsg = PS.onMsg;
		}
		
		// Associate our public interface with the window.

		M.win.stream = v_pub;
	};
	
	/*
	 * Clear state variables
	 */
	M.resetState = function()
	{
                M.lostStreamedData = "";
                M.MessageId = 0;
		M.state = C_STATE_DISCONNECTED;
		M.channelId = 0;
		M.nextSendSeq = 1;
		M.nextRecvSeq = 1;
		M.streamMode = C_MODE_UNKNOWN;
		M.missedBeats = 0;
		M.stmPosition = 0;
		M.sendQueue = [];
		M.encoder = [];
                M.conncted = false ;
	};

	/*
	 * Detect browser
	 */
	M.detectBrowser = function()
	{
		var v_name = navigator.userAgent;
		if(v_name.indexOf("Firefox") >= 0)
			M.browser = C_BROWSER_FIREFOX;
		else if(v_name.indexOf("Chrome") >= 0)
			M.browser = C_BROWSER_CHROME;
		else if(v_name.indexOf("Safari") >= 0)
			M.browser = C_BROWSER_SAFARI;
		else if(v_name.indexOf("MSIE") >= 0)
			M.browser = C_BROWSER_IE;
		else
			M.browser = C_BROWSER_UNKNOWN;
		M.log(LL_TRACE2, "Detected browser type:" + M.browser);
	};
	
	/*
	 * Determine what kind of access is being used: local/sub/crossdomain
	 */
	M.detectConnectionType = function()
	{
		M.connectionType = C_CONNECTION_LOCAL;

		// If a custom server has been specified, check how similar 
		// it is to the current document domain.

		if(M.proxyHost.length > 7 && M.proxyHost.indexOf(":") > 0)
		{
			// If a proxy host is specified, this can ONLY be a proxy server.
			M.connectionType = C_CONNECTION_PSERVER;
		}	
		else if(M.server.length > 7 && M.server.indexOf(":") > 0)
		{
			// Strip the http:// to make eg. data3.cognethos.com

			var v_dataserver = M.server.substr(M.server.indexOf(":") + 3);
			var v_origdomain = M.doc.domain; 

			if(v_dataserver != v_origdomain)
			{
				v_origdomain = M.getShortDomain(v_origdomain);
				v_dataserver = M.getShortDomain(v_dataserver);
				
				if(v_dataserver == v_origdomain)
				{
					// Different sub-domains only

					M.connectionType = C_CONNECTION_SUB; 
					M.log(LL_TRACE2, "Subdomain: " + v_origdomain);
					
					// Shorten the domain of the current document, so that 
					// we can be used by other documents from other 
					// subdomains of this domain.

					M.doc.domain = v_origdomain; 
				}
				else
				{
					// Domains aren't remotely similar. 
					// We'll need to use postMessage() to get things working.

					M.connectionType = C_CONNECTION_PCLIENT; 
				}
			}
		}
		
		M.log(LL_TRACE2, "Detected domain type: " + 
			M.domainTypeToString(M.connectionType));
	};
	
	/*
	 * Domain type to string
	 */
	M.domainTypeToString = function(v_domainType)
	{
		switch(v_domainType)
		{
			case C_CONNECTION_LOCAL: 	return "local";
			case C_CONNECTION_SUB:		return "sub";
			case C_CONNECTION_PCLIENT:	return "pclient";
			case C_CONNECTION_PSERVER:	return "pserver";
			default:					return "unknown";
		}
	};	

	/*
	 * Connect
	 */
	M.connect = function() 
	{
	    // Make sure we're disconnected

	    M.disconnect();
		
		// Acquire a server

		M.acquireServer();

	    // Setup config

	    M.cfg("hi", 5);
	    M.cfg("pr", M.preamble);
	    M.state = C_STATE_CONNECTING;

	    // Perform the rest of the connect asynchronously. This prevents
	    // Safari from showing the spinning loading indicator.

	    var timeout = 1;
	    
	    // Chrome requires a longer timeout to prevent the spinner.

	    if(M.browser == C_BROWSER_CHROME)
	        timeout = 1000;

	    M.connectTimer = M.win.setTimeout(M.connect2, timeout);
	};

	/*
	 * Connect phase 2
	 */
	M.connect2 = function()
	{
		M.connectTimer = 0;

		// If we have detected that the server is non-local, we need to
		// create an iframe to get through/around security restrictions.
		// In short: XmlHttpRequests need to be made from a frame loaded 
		// from that domain. If this is just a sub domain, load an iframe 
		// (sdframe.lp) now. It will call sdframeComplete when it has 
		// finished loading.

		switch(M.connectionType)
		{
			case C_CONNECTION_SUB:
				M.sdframeCreate();
				break;
			case C_CONNECTION_PCLIENT:
				throw C_UNEXPECTED;
				
			case C_CONNECTION_PSERVER:
			default:
				M.sendOpenRequest();
				break;
		}
	};

	/*
	 * Create the frame, for subdomain requests
	 */
	M.sdframeCreate = function()
	{
		if(M.connectionType != C_CONNECTION_SUB)
		{
			M.log(LL_ERROR, C_UNEXPECTED);
			return;
		}
		
		if(!M.sdframe)
		{
			M.log(LL_INFORMATION, "Creating sdframe");
			var v_frameName = "sdframe";
			var v_iframe = M.doc.createElement("iframe");
			v_iframe.style.display = "none";
			v_iframe.name = v_iframe.id = v_frameName;
			M.doc.body.appendChild(v_iframe);
			M.sdframe = M.win.frames[v_frameName];
		}
		else
		{
			M.log(LL_INFORMATION, "Restarting sdframe");
			// Deliberately tear down the iframe and reconnect.
			// This ensures that we have basic connectivity to the server
			// before we attempt to continue
			M.sdframe.location.replace(C_BLANK_URL);
		}

		M.sdframe.location.replace(
			M.server + "/stream/sdframe.html?d=" + M.doc.domain);

		// Ensure we get a connected ok, by starting a timeout
		M.startFrameTimer(M.sdframeTimeout);
	};

	/*
	 * The cross subdomain frame has finished loading, so continue 
	 * with the connection request.
	 */
	M.sdframeComplete = function()
	{
		M.sendOpenRequest();
		M.clearFrameTimer();
	};
	
	/*
	 * Subdomain frame load timeout.
	 */
	M.sdframeTimeout = function()
	{
		// Failed to load the frame in time.
		M.frameTimer = 0;
		M.dropConnection();
	};

	/*
	 * Starts a timer. 
	 * Used when to detect when loading a frame from a url fails.
	 */
	M.startFrameTimer = function(v_callback)
	{
		//M.log(LL_TRACE, "startFrameTimer");
		// Kill any existing timer
		if (M.frameTimer)
			M.win.clearTimeout(M.frameTimer);
			
		// Start the timer for an IFrame load
		M.frameTimer = M.win.setTimeout(v_callback, M.cfgFrameTimeout*1000);
	};
	
	/*
	 * Aborts the frame timeout callback.
	 */
	M.clearFrameTimer = function()
	{
		//M.log(LL_TRACE, "clearFrameTimer");
		if (M.frameTimer)
			M.win.clearTimeout(M.frameTimer);
		M.frameTimer = 0;
	};

	/*
	 * Disconnect
	 */
	M.disconnect = function()
	{
                M.conncted = false ;
		M.resetState();
		M.cancelStmRequest();
		M.cancelCmdRequest();

		if(M.disconnectTimer)
		{
			M.win.clearTimeout(M.disconnectTimer);
			M.disconnectTimer = 0;
		}	

		// Release the server, if we acquired one

		if(M.serverAcquired)
			M.releaseServer();
	};

	/*
	 * Cancel the streaming request and associated timers
	 */
	M.cancelStmRequest = function()
	{
		//M.log(LL_TRACE, "cancelStmRequest");
		if(M.stmRequest)
		{
			M.stmRequest.onreadystatechange = function() { 	
				//M.log(LL_TRACE2, "stmRequest onreadystatechange default"); 
			};
			M.stmRequest.abort();
			M.stmRequest = null;
		}

		// Cancel the heartbeat timer

		if(M.stmHeartTimer)
		{
			//M.log(LL_TRACE, "clearHeartbeat");
			M.win.clearTimeout(M.stmHeartTimer);
			M.stmHeartTimer = 0;
		}

		// Cancel the iframe request

		if(M.iframe)
			M.iframe.location.replace(C_BLANK_URL);
	};

	/*
	 * Cancel the command request
	 */
	M.cancelCmdRequest = function()
	{
		//M.log(LL_TRACE, "cancelCmdRequest:" + (!!M.cmdRequest));
		if(M.cmdRequest)
		{
			M.cmdRequest.onreadystatechange = function() {
				//M.log(LL_TRACE2, "cmdRequest onreadystatechange default"); 
			};
			M.cmdRequest.abort();
			M.cmdRequest = null;
		}
	};

	/*
	 * Log a debugging message
	 */
	M.log = function(v_level, v_msg)
	{
		// Put the level at the end, just in case the 
		// callback only uses one param.

		if(M.params.log)
			M.params.log(v_msg, v_level, M.doc.domain); 
		//try { console.log(M.doc.domain + " [" + v_level + "] " + v_msg); } catch(e) { }
	};
		
	/*
	 * Create an XMLHTTP request. If we're connecting to a different
	 * subdomain, this request needs to be made from an iframe loaded
	 * from that subdomain (this is the sdframe). Otherwise, we can
	 * just make the request ourselves.
	 */
	M.createRequest = function()
	{
		if(M.sdframe) return M.sdframe.createRequest();
		try { return new XMLHttpRequest(); } catch(e) {}
		try { return new ActiveXObject("Msxml2.XMLHTTP"); } catch(e) {}
		try { return new ActiveXObject("Microsoft.XMLHTTP"); } catch(e) {}
		return null;
	};

	/*
	 * Drop connection and send a disconnect callback
	 * TODO: add reason
	 */
	M.dropConnection = function()
	{
		M.log(LL_TRACE2, "Dropped");
		M.disconnect();
		if(M.params.onDisconnect)
			M.params.onDisconnect();
	};

	/*
	 * Start the heartbeat timer
	 */
	M.startHeartTimer = function()
	{
		//M.log(LL_TRACE, "startHeartTimer. mode:" + M.streamMode);
		var v_timeout;

		// Cancel the old timer
		
		if(M.stmHeartTimer)
			M.win.clearTimeout(M.stmHeartTimer);

		// If we're testing the stream mode, set a slightly shorter timer.
		// Might not want to wait the full heartbeat interval to figure 
		// out that the connection doesn't stream.

		if(M.streamMode == C_MODE_UNKNOWN)
			v_timeout = M.cfgStreamTimeout;
		else
			v_timeout = M.cfgHeartInterval;

		// Start the timer
		
		M.stmHeartTimer = M.win.setTimeout(M.onHeartTimer, v_timeout * 1000);
	};
	
	/*
	 * Handle the heartbeat timer
	 */
	M.onHeartTimer = function()
	{
		// If we were in testing mode and the heartbeat timer expired,
		// it means that the connection is non-streaming. So cancel
		// the request, switch to non-streaming mode, and reissue it.
		
		//M.log(LL_TRACE, "onHeartTimer. mode:" + M.streamMode);
		if(M.streamMode == C_MODE_UNKNOWN)
		{
			M.log(LL_INFORMATION, "Detected non-streaming connection");
			M.streamMode = C_MODE_NONSTREAMING;
			M.cancelStmRequest();
			M.sendNextRequest();
			return;
		}

		// Otherwise, it's a heartbeat timer. If we're in streaming mode
		// and we miss a certain number of heartbeats, it means that
		// the connection has gone dead, so need to reconnect.

		if(M.streamMode == C_MODE_STREAMING)
		{
			if(++M.missedBeats == M.cfgMaxMissedBeats)
			{
				M.log(LL_WARNING, "Missed " + M.cfgMaxMissedBeats + " heartbeats");
				M.dropConnection();
			}
			else
			{
				M.startHeartTimer(); // Start the timer again
			}
		}
	};
	
	/*
	 * Write a config command to the encoder
	 */
	M.cfg = function(v_name, v_value)
	{
		M.encoder.push("f(\"");
		M.encoder.push(v_name);
		M.encoder.push("\",");
		M.encoder.push(v_value);
		M.encoder.push(");\n");
	};
	
	/*
	 * Send the channel open request.
	 */
	M.sendOpenRequest = function()
	{
		M.log(LL_TRACE2, "sendOpenRequest");
                M.conncted = false ;
		M.stmRequest = M.createRequest();
		M.stmRequest.open("POST", M.server + "/signalr/negotiate?client=FLEX", true);
		//try { M.stmRequest.setRequestHeader("Connection", "Keep-Alive"); } catch(e) { }
		M.stmRequest.onreadystatechange = M.onOpenReply;
		M.stmRequest.send(M.buildCmdBody());
	};

	/*
	 * Send the next request
	 */
	M.sendNextRequest = function()
	{
                
		if(M.streamMode == C_MODE_NONSTREAMING)
		{
			// If the connection can't stream, use a simple 
			// polled XMLHttpRequest.
			M.sendNextRequestXmlHttp(false);
		}
		else if(M.browser == C_BROWSER_FIREFOX || 
				M.browser == C_BROWSER_CHROME ||
				M.browser == C_BROWSER_SAFARI || M.browser == C_BROWSER_UNKNOWN || M.browser == C_BROWSER_IE )
		{
			// For browsers that can look at the contents of XMLHttpRequest
			// as it comes back, make an XMLHttpRequest, but keep it open.
			M.sendNextRequestXmlHttp(true);
		}
		else
		{
                        
			// Our last resort (IE) is to stream through an iframe.
			M.sendNextRequestIFrame();
		}

		// In streaming mode, the heartbeat timer checks for drop-outs.
		// In unknown mode, it's used to detect streaming/nonstreaming.
		// In nonstreaming mode, it's not needed.

		/*if(M.streamMode != C_MODE_NONSTREAMING)
			M.startHeartTimer();*/
	};

	/*
	 * Send a streaming get request using an XmlHttpRequest. The stream
	 * parameter controls whether the request is streamed or not.
	 */
	M.sendNextRequestXmlHttp = function(v_stream)
	{
		//M.log(LL_TRACE2, "sendNextRequestXmlHttp. stream:" + v_stream);
		
		// Build the URL
		var v_url = M.server + "/signalr/connect?transport=longPolling&connectionId=" + M.channelId + "&connectionData=[{\"name\":\"Stream\"}]&client=FLEX";
		//v_url += "&get=" + M.nextRecvSeq;
		if(v_stream && M.conncted)
                {
			//v_url += "&stream=1";
                        v_url = M.server + "/signalR/?transport=longPolling&connectionId=" + M.channelId + "&messageId="+ M.MessageId + "&connectionData=[{'name':\'Stream\'}]&client=FLEX";
                        
                }

		// Chrome needs padding for XMLHttpRequest to stream
		if(M.browser == C_BROWSER_CHROME)
		    v_url += "&pad=1";

		//M.log(LL_INFORMATION, "Requesting URL:" + v_url);
		M.conncted = true;
		// Open a new request
		M.stmRequest = M.createRequest();
		M.stmRequest.open("GET", v_url, true);
		//try { M.stmRequest.setRequestHeader("Connection", "Keep-Alive"); } catch(e) { }
		M.stmRequest.onreadystatechange = M.onStmReply;
                M.stmRequest.responseType = "text";
		M.stmRequest.send(null);                
		M.stmPosition = 0;
                if(M.encodeArray.length > 0) 
                {
                   M.SetFlush();                    
                }
	};
        
        M.SetFlush = function()
        {
            M.firstFlushTimer = setInterval(M.sendFlush,1000);
        };        

	/*
	 * Set context on an object
	 */
	M.setContext = function(v_obj)
	{
		for(var v_key in M.context)
			v_obj[v_key] = M.context[v_key];
	};
	
	/*
	 * Get the short domain name
	 */
	M.getShortDomain = function(v_domain)
	{
		var v_array, v_str;
		
		v_array = v_domain.toLowerCase().split(".");

		// Leave IP addresses alone

		if(v_array.length == 4 && !isNaN(parseInt(v_array[3])))
			return v_domain;

		// Handle both ".com" and ".com.au" cases

		if(v_array.length > 2)
		{
			v_str = v_array[v_array.length - 2];
			if(v_str=="com" || v_str=="org" || v_str=="net" || v_str=="co")
				v_array = v_array.slice(v_array.length - 3);
			else
				v_array = v_array.slice(v_array.length - 2);
			v_domain = v_array.join(".");
		}

		return v_domain;
	};
	
	/*
	 * Create an IFrame
	 */
	M.createIFrame = function()
	{
		var v_frameName = "cogstream";

		if(M.browser == C_BROWSER_IE)
		{       
			var v_doc;
			v_doc = new ActiveXObject("htmlfile");
			v_doc.open();
			v_doc.write("<html>");
			v_doc.write("<script>document.domain='");
			v_doc.write(M.doc.domain);
			v_doc.write("';</script>");
			v_doc.write("<body>");
			v_doc.write("<iframe id='"+v_frameName+"'></iframe>");
			v_doc.write("</body></html>");
			v_doc.close();
			M.iframeFile = v_doc;
			M.iframeParent = v_doc.parentWindow;
			M.iframe = v_doc.parentWindow.frames[v_frameName]; 
			v_doc.parentWindow.stream = v_pub;
		}
		else
		{                       
			var v_iframe;
			v_iframe = M.doc.createElement("iframe");
			v_iframe.style.display = "none";
			v_iframe.name = v_iframe.id = v_frameName;
			M.doc.body.appendChild(v_iframe);
			M.iframe = M.win.frames[v_frameName];
		}
	};
	
	/*
	 * Send a streaming get request using an IFrame
	 */
	M.sendNextRequestIFrame = function()
	{
		var v_url;

		// If there is no iframe yet, create it

		if(!M.iframe)
			M.createIFrame();
		
		// Build the URL and start the request		
		M.log(LL_TRACE2, "sendNextRequestIFrame");
		v_url = M.server + "/signalr/connect?transport=longPolling&connectionId=" + M.channelId + "&connectionData=[{\"name\":\"Stream\"}]&client=FLEX";
                if(M.conncted)v_url = M.server + "/signalR/?transport=longPolling&connectionId=" + M.channelId + "&messageId="+ M.MessageId + "&connectionData=[{\"name\":\"Stream\"}]&client=FLEX";
		//v_url += "&stream=1&html=1&pad=1";
		M.conncted = true;
		M.iframe.location.replace(v_url);
                //M.sendFlush();
                if(M.encodeArray.length > 0) 
                {
                   M.SetFlush();                    
                }
	};

	/*
	 * Handle response to the initial open request
	 */
	M.onOpenReply = function()
	{
		var v_status, v_text;
		
		// Wait for it to complete

		if(M.stmRequest.readyState != 4)
			return;

		// Get the status and text

		v_status = M.stmRequest.status;
		v_text = M.stmRequest.statusText;

		// If it failed, drop the connection
		
		if(v_status != 200)
		{
			M.log(LL_TRACE, "onOpenReply: " + v_status + " " + v_text);
			M.dropConnection();
			return;
		}

		// All data in the encoder is now acknowledged, 
		// so we can get rid of it.

		M.encoder = [];

		// Evaluate the returned data

	    v_data = M.stmRequest.responseText;
		M.evalReply(v_data);

		// Send the next streaming request, and also flush any
		// new commands that have been added in the meantime.

	    if(M.state == C_STATE_CONNECTED)
		{
                        M.sendNextRequest();
			//M.sendFlush();
		}	
	};

	/*
	 * Handle events on the streaming XmlHttpRequest
	 */
	M.onStmReply = function() 
	{            
	    var v_status, v_text, v_pos, v_data;

	    // Chrome lands here when leaving a page when still connected
	    // M.stmRequest is null so just abort, rather than dropping the 
		// connection and calling onDisconnect.
	    if(M.stmRequest == null)
	        return;

	    //M.log(LL_TRACE, "onStmReply.readyState=" + M.stmRequest.readyState );
	    if (M.stmRequest.readyState < 3)
	        return;

	    // In Firefox, we can see streaming data at readyState 3.
	    // In IE, we'll crash if we try to access the status properties.

	    if (M.stmRequest.readyState == 3 && M.browser == C_BROWSER_IE)
	        return;

	    // Get the status and text. If the connection fails, this will
	    // throw an error (at least on firefox).

	    try 
		{
	        v_status = M.stmRequest.status;
	        v_text = M.stmRequest.statusText;
	    }
	    catch(e) 
		{
	        v_status = 404;
	        v_text = "Connection failed";
	    }

	    // If the request failed, drop the channel
	    //M.log(LL_TRACE, "onStmReply.status=" + v_status );

	    if(v_status != 200) 
		{
	        //M.log(LL_TRACE, "onStmReply: " + v_status + " " + v_text);
	        M.dropConnection();
	        return;
	    }
            
            v_data = M.lostStreamedData + M.stmRequest.responseText;
            //if(v_data.length == 0 )return;
            
            if( v_data.search("MessageId") > 0 )
            {
                var s = v_data.substr(v_data.search("MessageId")-2,((v_data.search("MessageId")-2) + v_data.indexOf(","))) + "}";
                M.MessageId = eval('(' + s + ')').MessageId;
            }
            
	    // Handle partial data

	    //console.log(M.stmRequest.responseText);

	    if(M.stmRequest.readyState === 3) 
            {
                    /*v_pos = v_data.lastIndexOf("}}", v_data.length);

                    if(v_pos > M.stmPosition) 
                    {
                            v_data = v_data.substr(v_data.indexOf("m("),(v_data.lastIndexOf(";") + 1) - v_data.indexOf("m("));
                            v_data = v_data.replace(/;","/g,";");	
                            v_data = v_data.replace(/\\"/g,"\"");
                            M.stmPosition = v_pos + 2;
                            M.evalReply(v_data);
                    }*/
                    return;
	    }

	    // Handle end of request   
            
            if( v_data.lastIndexOf("m(") < 0 )
            {
                //alert("v_data="+v_data);
                M.sendNextRequest();
                return;                
            }
            
            
            
            M.lostStreamedData = (v_data.indexOf("}}") === (v_data.length - 2))? "":( v_data.substr(v_data.lastIndexOf(";")));
	    if (M.stmPosition)
	        v_data = v_data.substr(M.stmPosition);
            
            v_data = v_data.substr(v_data.indexOf("m("),(v_data.lastIndexOf(";") + 1) - v_data.indexOf("m("));
            v_data = v_data.replace(/;","/g,";");	
            v_data = v_data.replace(/\\"/g,"\"");
            
            
            
	    if(v_data!=="")M.evalReply(v_data);

	    // If we're connected, send the next get request
             

	    if (M.state == C_STATE_CONNECTED || M.conncted == true )
		{                
			var t = setTimeout(function(){M.sendNextRequest();}, 1000);
		}
	};

	/*
	 * Send a message. Basically we add it to the send queue, then attempt
	 * to flush the send queue into the encoder.
	 */
	M.send = function(v_type, v_header, v_body)
	{
		if(M.state == C_STATE_DISCONNECTED)
			return false;
		var v_msg = {};
		v_msg.m_type = v_type;
		v_msg.m_header = v_header;
		v_msg.m_body = v_body;
		M.sendQueue.push(v_msg);
		M.sendFlush();
		return true;
	};

	/*
	 * Flush commands if possible
	 */
	M.sendFlush = function()
	{
                if(M.firstFlushTimer){
                    clearInterval(M.firstFlushTimer);
                    M.firstFlushTimer = 0;
                }
		var v_url;

		// Must be connected
		if(M.state != C_STATE_CONNECTED)
		{
			//M.log(LL_TRACE2, "sendFlush failed. Not connected");
			return;
		}

		// Need to have data either in the send queue or in the encoder.
		// We might have an empty send queue but a non-empty encoder if
		// this is a retry of a failed request.
		if(M.sendQueue.length == 0 && M.encoder.length == 0)
		{
			//M.log(LL_TRACE2, "sendFlush failed. no queue length");
			return;
		}

		// If there is already a pending command request, wait for it
		// to finish.
		if(M.cmdRequest != null)
		{
			//M.log(LL_TRACE2, "sendFlush failed. request pending");
			return;
		}

		// Ok, send it
                if(M.conncted)
                {
                    v_url = M.server + "/signalR/send?transport=longPolling&connectionId=" + M.channelId + "&connectionData=[{\"name\":\"Stream\"}]&client=FLEX";
                    M.cmdRequest = M.createRequest();
                    M.cmdRequest.open("POST", v_url, true);
                    M.cmdRequest.onreadystatechange = M.onCmdReply;
                    M.cmdRequest.send(M.buildCmdBody());
                }
                
		
	};
	
	/*
	 * Handle a command reply
	 */
	M.onCmdReply = function()
	{
		var v_status, v_text;
		
		// Wait for it to complete

		if(M.cmdRequest.readyState != 4)
			return;

		// Get the status and text

		v_status = M.cmdRequest.status;
		v_text = M.cmdRequest.statusText;

		// If it failed, drop the connection
		
		if(v_status != 200)
		{
			M.log(LL_TRACE, "onCmdReply: " + v_status + " " + v_text);
			M.dropConnection();
			return;
		}

		// Otherwise it succeeded. All data in the encoder is now
		// acknowledged, so we can get rid of it.

		M.cmdRequest = null;
		M.encoder = [];

		// See if there's more data to send
		M.sendFlush();
	};
	
	/*
	 * This method generates the body for a command request. Basically
	 * this means any data that was already in the encoder, plus the
	 * contents of the send queue. The contents of the send queue is
	 * encoded, removed from the send queue, and stored in the encoder
	 * until it has been acknowledged as received by the the server.
	 */
	M.buildCmdBody = function()
	{
		var v_i, v_msg;

		// If there is at least one message in the send queue,
		// bump the sequence number, and write a new sequence number
		// message.
		
		if(M.sendQueue.length > 0)
		{
			M.encoder.push("q(");
			M.encoder.push(M.nextSendSeq++);
			M.encoder.push(");\n");
		}
		
		// Now write all the messages in the queue
		
		for(v_i = 0; v_i < M.sendQueue.length; v_i++)
		{
			v_msg = M.sendQueue[v_i];
			M.encoder.push("m(");
			M.encoder.push(v_msg.m_type);
			M.encoder.push(",");
			M.encoder.push(v_msg.m_header.length / 2);
			M.encodeArray(v_msg.m_header);
			M.encodeArray(v_msg.m_body);
			M.encoder.push(");\n");
		}

		// Join all the strings in the encoder together.
		
		M.sendQueue = [];
		M.encoder = [M.encoder.join("")];
		return M.encoder[0];
	};
	
	/*
	 * Encode an array (header or body of a message)
	 */
	M.encodeArray = function(v_array)
	{
		if(!v_array)
			return;
		
		for(var v_i = 0; v_i < v_array.length; v_i += 2)
		{
			M.encoder.push(",");
			M.encoder.push(v_array[v_i]);
			M.encoder.push(",");

			if(M.win.uneval)
				M.encoder.push(uneval(v_array[v_i+1]));
			else
				M.encodeValue(v_array[v_i+1]);
		}
	};
	
	/*
	 * Encode a value (used only if uneval is not available)
     */
    M.encodeValue = function(v_value)
	{
		if(typeof(v_value) == "string")
		{
			// TODO: handle escape codes
			M.encoder.push("\"");
			M.encoder.push(v_value);
			M.encoder.push("\"");
		}
		else
		{
			M.encoder.push(v_value);
		}
	};
	
	/*
	 * Encode a JSON object as a string
	 */
	M.serialize = function(_obj)
	{
		if (!_obj) 
			return "null";
		
	   // Let Gecko browsers do this the easy way

	   if(typeof _obj.toSource !== 'undefined' && 
	      typeof _obj.callee === 'undefined')
	   {
		  return _obj.toSource();
	   }

	   // Other browsers must do it the hard way

	   switch(typeof _obj)
	   {
		  // Numbers, booleans, and functions are trivial:
		  // just return the object itself since its default .toString()
		  // gives us exactly what we want
		  case 'number':
		  case 'boolean':
		  case 'function':
			 return _obj;
			 break;

		  // for JSON format, strings need to be wrapped in quotes
		  case 'string':
			 return '\'' + _obj + '\'';
			 break;

		  case 'object':
			 var str;
			 if(_obj.constructor === Array || 
			    typeof _obj.callee !== 'undefined')
			 {
				str = '[';
				var i, len = _obj.length;
				for(i = 0; i < len-1; i++) 
					str += M.serialize(_obj[i]) + ','; 
				str += M.serialize(_obj[i]) + ']';
			 }
			 else
			 {
				str = '{';
				var key;
				for(key in _obj) 
					str += key + ':' + M.serialize(_obj[key]) + ','; 
				str = str.replace(/\,$/, '') + '}';
			 }
			 return str;
			 break;

		  default:
			 return 'UNKNOWN';
			 break;
	   }
	};

	/*
	 * Evaluate a response
	 */
	M.evalReply = function(v_text)
	{
		with(M.context)
                {
                    eval(v_text);
                    //eval("c('123456-789');")
                }
                
	};

	/*
	 * Handle a channel command
	 */
	M.cmdChannel = function(v_id)
	{                
		M.channelId = v_id;
		M.state = C_STATE_CONNECTED;
		if(M.params.onConnected)
			M.params.onConnected();
		//M.sendFlush();
	};

	/*
	 * Handle a heartbeat command
	 */
	M.cmdHeartbeat = function(v_time)
	{
		// If we're still testing the connection, receiving a heartbeat
		// before our timer expired means that the connection can stream.
		// Otherwise our timer would have expired, and retried the
		// connection as non-streaming.
		
		if(M.streamMode == C_MODE_UNKNOWN)
		{
			M.log(LL_INFORMATION, "Detected streaming connection");
			M.streamMode = C_MODE_STREAMING;
		}
		
		// If we're confirmed to be in streaming mode, reset the number
		// of missed beats, and start a timer to check for the next
		// heartbeat. In non-streaming mode, the server will not force
		// a connection close to flush a heartbeat, so we can't rely
		// on them being sent in a timely fashion. (However it still
		// does send them, just to tell the proxy that it's still alive).

		if(M.streamMode == C_MODE_STREAMING)
		{
			M.missedBeats = 0;
			M.startHeartTimer();
		}
	};

	/*
	 * Handle a refresh command
	 */
	M.cmdRefresh = function()
	{
		M.log(LL_TRACE, "cmdRefresh");
		M.sendNextRequest();
	};

	/*
	 * Handle a sequence command
	 */
	M.cmdSequence = function(v_seq)
	{
		//M.log(LL_TRACE3, "cmdSequence: " + v_seq);
		M.nextRecvSeq = v_seq + 1;
	};

	/*
	 * Handle an error command
	 */
	M.cmdError = function(v_error)
	{
		M.log(LL_WARNING, "cmdError" + v_error);
		M.dropConnection();
	};
	
	/*
	 * Handle a message command
	 */
	M.cmdMsg = function(v_type, v_hsize)
	{
		var v_header, v_body, v_pos;
		v_pos = 2 + v_hsize * 2;
		v_header = Array.prototype.slice.call(arguments, 2, v_pos);
		v_body = Array.prototype.slice.call(arguments, v_pos);
		try{
			if(M.params.onMsg)
				M.params.onMsg(v_type, v_header, v_body);
		} 
		catch(v_e) 
		{ 
			M.log(LL_WARNING, "cmdMsg failed. type:" + v_type + 
				" hdr:'" + v_header + "' body:'" + v_body + 
				"' error:'" + v_e + "'");
		}
	};
	
	/*
	 * Init Cross Domain Messaging. Registers for DOM Message events. 
	 * This is used by Proxy Client/Servers to communicate.
	 */
	M.initXDMessaging = function(v_func)
	{
		try 
		{
			if (M.win.addEventListener)
				M.win.addEventListener("message", v_func, false);
			else if ( M.win.attachEvent )
				M.win.attachEvent("onmessage", v_func);
			else
				M.log(LL_ERROR, "Cannot do XD messaging");
		} 
		catch(e) { M.log(LL_ERROR, "XD init Error:" + e.message || e); }
	};
	
	/*
	 * Send a cross domain message
	 */
	M.sendXDMessage = function(v_data)
	{
		var v_target = "*";
		try 
		{
                        
			var v_str = M.serialize(v_data);                        
			M.xdframe.postMessage(v_str, v_target ); 
		} 
		catch(e) { M.log(LL_ERROR, "XD Error:" + e.message || e); }
	};
	
	/*
	 * Acquire an unused server
	 */
	M.acquireServer = function()
	{
		// If there are no alternate servers, or if the server was
		// already acquired, don't need to do anything.

		if(!M.altServers || M.serverAcquired)
			return;

		// Find a server that is not yet used.

		for(var v_i in M.altServers)
		{
			var v_server = M.altServers[v_i];

			if(!M.isServerInUse(v_server))
			{
				var v_usedServers = M.readCookie(C_SERVERS_COOKIE);
				if(v_usedServers == null || v_usedServers.length == 0)
					v_usedServers = v_server;
				else
					v_usedServers = v_usedServers + "," + v_server;

				M.writeCookie(C_SERVERS_COOKIE, v_usedServers);
				M.server = v_server;
				M.serverAcquired = true;
				M.log(LL_INFORMATION, "Acquired server: " + v_server);
				return true;
			}	
		}

		// If all servers are in use, just print a warning, and
		// revert to the first server.

		M.log(LL_WARNING, "All servers used");
		M.server = M.altServers[0];
		M.serverAcquired = false;
		return false;
	};

	/*
	 * Release an acquired server
	 */
	M.releaseServer = function()
	{
		if(!M.serverAcquired || !M.server)
			return;

		var v_usedServers = M.readCookie(C_SERVERS_COOKIE);
		if(v_usedServers == null)
			return;

		var v_list = v_usedServers.split(",");
		var v_result = "";

		for(var v_i in v_list)
		{
			if(v_list[v_i] != M.server)
			{
				if(v_result.length > 0)
					v_result += ",";
				v_result += v_list[v_i];
			}
		}	

		M.log(LL_INFORMATION, "Released server: " + M.server);
		M.writeCookie(C_SERVERS_COOKIE, v_result);
		M.server = null;
		M.serverAcquired = false;
	};

	/*
	 * Return true if a server is in use
	 */
	 M.isServerInUse = function(v_name)
	 {
		var v_usedServers = M.readCookie(C_SERVERS_COOKIE);
		if(v_usedServers == null)
			return false;
		var v_list = v_usedServers.split(",");
		for(var v_i in v_list)
			if(v_list[v_i] == v_name)
				return true;
		return false;
	};

	/*
	 * Read the value of a cookie
	 */
    M.readCookie = function(v_name)
    {
	    var v_entries = document.cookie.split(";");
    	
	    // Iterate over each entry and try to find the one 
		// specified by v_name.

	    for(var v_i in v_entries)
	    {
			var v_entry = v_entries[v_i];
		    var v_cname = v_name + '=';
		    var v_pos = v_entry.indexOf(v_cname);

		    if(v_pos > -1)
			{
				v_pos += v_cname.length;
			    return v_entry.substring(v_pos, v_entry.length);
			}
	    }

	    return null;	
    };

	/*
	 * Write the value of a cookie
	 */
	M.writeCookie = function(v_name, v_value)
	{
		document.cookie = v_name + "=" + v_value + "; path=/";
	};

	/*
	 * Proxy Client Init
	 */
	PC.init = function()
	{
		// Messaging cannot be done directly when going cross domain.
		// Set up a proxy client instead.

		// Register for messages
		M.initXDMessaging(PC.onMessage);
		
		// Store what we expect the safe origin to be
		M.proxytarget = M.server;
	};
	
	/*
	 * Proxy Client connect
	 */
	PC.connect = function()
	{
		PC.drop();
		M.state = C_STATE_CONNECTING;
		
		// If we have detected that the server is non-local, we need to create an 
		// iframe to get through/around security restrictions.
		// XmlHttpRequests need to be made from a frame loaded from that domain. 
		// load an iframe (xdframe.lp) now and save the window handle.
		// We will use postMessage() to send messages to it (disconnect/send)
		// (Note that connect() is implied and isn't needed)
		// and it will send response to us via PC.onMessage
			
		var v_url = M.doc.URL;
		if(v_url.indexOf("/", 8)>0)
			v_url = v_url.substr(0, v_url.indexOf("/", 8));
		if(!M.xdframe)
		{
			M.log(LL_INFORMATION, "Creating xdframe");
			var v_frameName = "xdframe";
			var v_iframe = M.doc.createElement("iframe");
			v_iframe.style.display = "none";
			v_iframe.name = v_iframe.id = v_frameName;
			M.doc.body.appendChild(v_iframe);
			M.xdframe = M.win.frames[v_frameName];
		}
		else
		{
			M.log(LL_INFORMATION, "Restarting xdframe");
			// Deliberately tear down the iframe and reconnect.
			// This ensures that we have basic connectivity to the server
			// before we attempt to continue
			M.xdframe.location.replace(C_BLANK_URL);
		}
		M.xdframe.location.replace(M.server + "/stream/xdframe.html?d=" + v_url);
		
		M.log(LL_INFORMATION, "XD: " + 
			M.server + "/stream/xdframe.html?d=" + v_url);

		// Ensure we get a connected ok, by starting a timeout
                
		M.startFrameTimer(PC.frameTimeout);
	};
	
	/*
	 * Cross domain frame load timeout.
	 */
	PC.frameTimeout = function()
	{
		// Failed to load the frame in time.
		M.log(LL_TRACE, "PC Dropped");
		M.frameTimer = 0;
		PC.onServerDisconnected();		
	};

	/*
	 * Server loaded/available notification message
	 */
	PC.onServerLoaded = function()
	{
	};
	
	/*
	 * Server connected notification messsage
	 */
	PC.onServerConnected = function()
	{
		M.state = C_STATE_CONNECTED;
		M.clearFrameTimer();
		if(M.params.onConnected)
			M.params.onConnected();
		PC.sendFlush(); 
	};

	/*
	 * Proxy Client disconnect all comms/reset
	 */
	PC.drop = function()
	{
		if(M.xdframe)
			M.xdframe.location.replace(C_BLANK_URL);
			
		M.resetState(); 
	};
	
	/*
	 * Proxy Client 
	 */
	PC.disconnect = function()
	{
                
		PC.drop();

		// Needed here since disconnect is called during connect, 
		// but before the frame is actually created.

		if(M.xdframe)
			M.sendXDMessage({type:C_MSG_DISCONNECT});
	};
	
	/*
	 * Server disconnected notification
	 */
	PC.onServerDisconnected = function()
	{
                
		PC.drop();
		// Cancel the iframe request
		if(M.xdframe)
			M.xdframe.location.replace(C_BLANK_URL);
		if(M.params.onDisconnect)
			M.params.onDisconnect();			
	};
	
	/*
	 * Proxy Client 
	 */
	PC.send = function(v_type, v_header, v_body)
	{
		if(M.state == C_STATE_DISCONNECTED)
			return false;
		var v_msg = {};
		v_msg.m_type = v_type;
		v_msg.m_header = v_header;
		v_msg.m_body = v_body;
		M.sendQueue.push(v_msg);
		PC.sendFlush();
		return true;
	};

	/*
	 * Flush commands if possible
	 */
	PC.sendFlush = function(v_bForceSend)
	{
		// Must be connected
		if(M.state != C_STATE_CONNECTED && !v_bForceSend)
		{
			//M.log(LL_TRACE2, "PC sendFlush failed. Not connected");
			return;
		}

		// Need to have data either in the send queue or in the encoder.
		// We might have an empty send queue but a non-empty encoder if
		// this is a retry of a failed request.

		if(M.sendQueue.length == 0 && M.encoder.length == 0)
		{
			//M.log(LL_TRACE2, "sendFlush failed. no queue length");
			return;
		}

		// Ok, send the messages now

		for(var v_i = 0; v_i < M.sendQueue.length; v_i++)
		{
			var v_msg = M.sendQueue[v_i];
			M.sendXDMessage({type:C_MSG_SEND, msgtype:v_msg.m_type, 
				msghdr:v_msg.m_header, msgbody:v_msg.m_body});
		}

		M.sendQueue = [];
	};
	
	
	/*
	 * Proxy Client message handler. These messages are sent 
	 * from the proxy server.
	 */
	PC.onMessage = function (v_event)
	{
                
		if(v_event.origin != M.proxytarget) 
		{
			M.log(LL_WARNING, "PC. Unknown origin: " + v_event.origin);
			return;
		}		

		var v_data = eval("("+v_event.data+")");
               
		switch(v_data.type)
		{
			case C_MSG_ONLOADED:
				PC.onServerLoaded();
				break;
			case C_MSG_ONCONNECTED:
				PC.onServerConnected();
				break;
			case C_MSG_ONDISCONNECTED:
				PC.onServerDisconnected();
				break;
			case C_MSG_ONMSG:
				if(M.params.onMsg)
					M.params.onMsg(v_data.msgtype, v_data.msghdr, v_data.msgbody);
				break;
		}
	};
	
	/*
	 * Proxy Server Init
	 */
	PS.init = function()
	{
		// messaging cannot be done directly when going cross domain.
		// Set up a proxy Server instead.

		// register for messages
		M.initXDMessaging(PS.onMessage);
		
		// Store what we expect the safe origin to be
		M.proxytarget = M.proxyHost;
		
		// store where we send cross domain messages to (the parent of xdframe.lp)
		M.xdframe = M.win.parent;
		
		// let's startup straight away
		M.connect(); 
		
		// let's also immediately tell the owning frame that we're here
		M.sendXDMessage({type:C_MSG_ONLOADED});
	};
	
	/*
	 * Proxy Server connected callback
	 */
	PS.onConnected = function()
	{
		M.sendXDMessage({type:C_MSG_ONCONNECTED});
	};
	
	/*
	 * Proxy Server disconnect callback
	 */
	PS.onDisconnect = function()
	{
		M.sendXDMessage({type:C_MSG_ONDISCONNECTED});
	};
	
	/*
	 * Proxy Server Message callback
	 */
	PS.onMsg = function(v_type, v_header, v_body)
	{
                
		M.sendXDMessage({type:C_MSG_ONMSG, msgtype:v_type, 
			msghdr:v_header, msgbody:v_body});
		return true;
	};
	
	/*
	 * Proxy Server message handler. These messages are sent 
	 * from the proxy server.
	 */
	PS.onMessage = function(v_event)
	{
                
		if(v_event.origin != M.proxytarget) 
		{
			M.log(LL_WARNING, "PS. Unknown origin: " + v_event.origin);
			return;
		}
		
		var v_data = eval("("+v_event.data+")");

		switch(v_data.type)
		{
			case C_MSG_DISCONNECT:
				M.disconnect();
				break;
			case C_MSG_SEND:                                
				M.send(v_data.msgtype, v_data.msghdr, v_data.msgbody);
				break;
		}
	};
	
	/*
	 * Run initialisation and return public interface
	 */
	M.init(v_window, v_params);

	switch(M.connectionType)
	{
		case C_CONNECTION_PCLIENT:
			PC.init();
			v_pub.send = PC.send;
			v_pub.connect = PC.connect;
			v_pub.disconnect = PC.disconnect;
			break;
			
		case C_CONNECTION_PSERVER:
			PS.init();
			v_pub.send = M.send;
			v_pub.connect = M.connect;
			v_pub.disconnect = M.disconnect;
			v_pub._sc = M.setContext;
			break;
			
		default:
			v_pub.send = M.send;
			v_pub.connect = M.connect;
			v_pub.disconnect = M.disconnect;
			v_pub._sc = M.setContext;
			v_pub._xc = M.sdframeComplete;
			break;
	}

	return v_pub;
};

/*
 * This function used by xdframe.lp
 */
function getUrlParam(v_name)
{
	v_name = v_name.replace(/[\[]/,"\\\[").replace(/[\]]/,"\\\]");
	var v_regex = new RegExp("[\\?&]" + v_name + "=([^&#]*)");
	var v_results = v_regex.exec(window.location.href);
	if(!v_results)
		return "";
	else
		return v_results[1];
};

/*
 * data.js  (requires stream.js)
 * Data Layer
 *
 * Callback functions:
 
	function onStatus(dataItem, state, error, errMsg)
	function onConnectionStatus(state, error, errMsg) 
	function onRecordUpdate(record, bIsImage, fields) 

initialisation params:
	source : "IDN_RDF"				// empty by default
	server : "http://localhost"		// empty by default
	useDictionary : true			// true by default
	cacheData : true				// true by default
	conflation: 250					// 250ms by default
	
eg.
    function doRecordUpdate(record, bIsImage, fields) { }
    function onStatusChanged(dataItem, state, error, errMsg) { }  
    data.init(window, { onRecordUpdate: doRecordUpdate, onStatus: onStatusChanged} );
 */
//grob:prefixes=C_,v_,m_,P_,LL_
//grob:namespaces=M

(function()
{
	var v_pub = {}; // the public 'interface'. This is exposed as 'window.data'

	var M = {};
	
	/*
	 * Data message protocol version
	 * Send this using DatKeyProtocol in the login message.
	 */
	var C_DAT_PROTOCOL_VERSION = 1;

	/*
	 * Data message types
	 */
	var C_DatMsg =
	{
		C_Login			: 1,
		C_Subscribe		: 2,
		C_Unsubscribe	: 3,
		C_Mount			: 4,
		C_Dismount		: 5,
		C_Image			: 6,
		C_Update		: 7,
		C_Status		: 8,
		C_Error			: 9
	};

	/*
	 * Data header keys
	 */
	var C_DatKey =
	{
		Tag			: 1,
		Source		: 2,
		Item		: 3,
		Format		: 4,
		State		: 5,
		Error		: 6,
		Text		: 7,
		Params		: 8,
		Filter		: 9,
		Conflation	: 10,
		Protocol	: 32,
		Username	: 33,
		Password	: 34,
		Application	: 35
	};

	/*
	 * Data format
	 */
	var C_DatFormat =
	{
		None		: 0,
		Record		: 1,
		Page		: 2,
		Table		: 3,
		Dict		: 4
	};

	/*
	 * Data state
	 */
	var C_DatState =
	{
		Live			: 0,
		Pending			: 1,
		Stale			: 2,
		Closed			: 3
	};

	/*
	 * Data error
	 */
	var C_DatError =
	{
		None				: 0,
		InvalidRequest		: 1,
		InvalidArg			: 2,
		InvalidSource		: 3,
		InvalidItem			: 4,
		AlreadyMounted		: 5,
		PermissionDenied	: 6,
		NotRequested		: 7,
		NotLoggedIn			: 8,
		InvalidUser			: 9,
		InvalidProtocol		: 10
	};

	/*
	* Log Levels (defined in stream.js, redefined here for better obfuscation)
	*/
    var LL_ERROR        = LogLevel.ERROR;
	var LL_WARNING		= LogLevel.WARNING;
	var LL_INFORMATION	= LogLevel.INFORMATION;
	var LL_TRACE		= LogLevel.TRACE;
	var LL_TRACE1		= LogLevel.TRACE1;
	var LL_TRACE2		= LogLevel.TRACE2;
	var LL_TRACE3		= LogLevel.TRACE3;

	/*
	 * Data types
	 * These types are used in the dictionary
	 */
	var C_DatType =
	{
		None			: 0,
		String			: 1,
		Integer			: 2,
		Float			: 3,
		Time			: 4,
		Date			: 5,
		DateTime		: 6
	};


	/*
	 * Source mount parameter keys
	 */
	//var C_DAT_PARAM_DIR = "dir";	// Set to 1 if dir requests are supported
	//var C_DAT_PARAM_WEB = "web"; 	// Set to 1 if web requests are supported

	/*
	 * Well-known source names
	 */
	var C_DAT_SOURCE_ROOT = "#root";

	/*
	 * Well-known source item names
	 */
	var C_DAT_ITEM_DIR	= "#dir";			// Directory item
	var C_DAT_ITEM_DICT	= "#dict";			// Dictionary item
	var C_DAT_ITEM_TIME	= "#time";			// Root time item

	/*
	* Misc constants/vars
	*/
	var v_undefined; // jQuery trick to speed up references to undefined values/objects
	var C_DefaultConflation = 250; // ms
	

	M.reset = function()
	{
		M.m_bConnected = false;
	    M.m_loginSent = false;
	    M.m_nextRequestId = 1; // increments with every request
	    M.m_requests = {}; // out list of requests
	    M.m_dictionaries = {};
	};
	
    M.init = function(v_callback, v_window)
    {
        if (!v_callback)
            throw "invalid args to init function";
            
		if (!v_window)
			v_window = window;
		M.win = v_window;
		M.timer = 0;
		M.setConnectionStatus(C_DatState.Pending, C_DatError.None);
	    var v_cb = {};
	    for (var v_key in v_callback)
	    {
			v_cb[v_key] = v_callback[v_key];
		}
	    v_cb.onMsg = M.onMsg; // specify the callback for messages as ourselves.
	    v_cb.onConnected = M.onStreamConnected;
	    v_cb.onDisconnect = M.onStreamDisconnected; // stream api uses OnDisconnect, rather than OnDisconnected :(
	    v_pub.stream = createStream(v_window, v_cb);
	    v_pub.i.callback = v_callback; // keep a reference to the user's callback procs

		M.reset();
	};
	
	M.connect = function()
	{
		M.reset();
	    
		M.setConnectionStatus(C_DatState.Pending, C_DatError.None);
		v_pub.stream.connect();
	};
	
	M.disconnect = function()
	{
		try{v_pub.stream.disconnect();}catch(e) { };
		M.setConnectionStatus(C_DatState.Closed, C_DatError.None);
		for (var v_id in M.m_requests)
		{
			if (M.m_requests[v_id])
				M.setItemStatus(M.m_requests[v_id], C_DatState.Closed, C_DatError.None);
		}
			
	    M.m_nextRequestId = 1; // increments with every request
	    M.m_requests = {}; // out list of requests
	    M.m_dictionaries = {};
	};

	M.setItemStatusInternal = function(v_obj, v_state, v_error, v_errMsg)
	{
		if (!v_obj)
			return;
		if (v_obj.state == v_undefined) v_obj.state=-1;
		if (v_obj.stateError == v_undefined) v_obj.stateError=-1;
		if (v_obj.state == v_state && v_obj.stateError == v_error)
			return; // don't propagate status changes when nothing changed
		v_obj.state = v_state;
		v_obj.stateError = v_error;
		v_obj.stateErrorMsg = v_errMsg || "";
	};
	
	/*
	* Called when a dataitem's state has changed
	*/
	M.setItemStatus = function(v_dataItem, v_state, v_error, v_errMsg)
	{
		M.setItemStatusInternal(v_dataItem, v_state, v_error, v_errMsg);
			
		if (v_dataItem && v_dataItem.m_requestParams.onStatus)
			v_dataItem.m_requestParams.onStatus(v_dataItem, v_state, v_error, v_errMsg || "");
		else
		if (v_pub.i.callback.onStatus)
			v_pub.i.callback.onStatus(v_dataItem, v_state, v_error, v_errMsg || "");
	};
	
	/*
	* called when a status changes on the connection (or no dataitem exists)
	*/
	M.setConnectionStatus = function(v_state, v_error, v_errMsg)
	{
		M.setItemStatusInternal(v_pub, v_state, v_error, v_errMsg);
			
		if (v_pub.i.callback.onConnectionStatus)
			v_pub.i.callback.onConnectionStatus(v_state, v_error, v_errMsg || "");
		else
		if (v_pub.i.callback.onStatus) // try and call onStatus
			v_pub.i.callback.onStatus(null, v_state, v_error, v_errMsg || "");
	};
			
	/*
	* called only on failure within CogCache
	*/
	M.setErrorStatus = function(v_dataItem, v_error, v_errMsg)
	{
		if (v_dataItem)
			M.setItemStatus(v_dataItem, C_DatState.Closed, v_error, v_errMsg);
		else
			M.setConnectionStatus(C_DatState.Closed, v_error, v_errMsg);
	};
	
	/*
	* given an array or key/value pairs, convert it to a map
	*/
	M.arrayToMap = function(v_array)
	{
		var v_map = {};
		for (var v_i=0; v_i<v_array.length; v_i+=2)
		{
			v_map[v_array[v_i]] = v_array[v_i+1];
		}
		return v_map;
	};
	
	/*
	* Given an enum value, lookup the given enum definition and return it's name
	*/
	M.enumLookupString = function(v_value, v_map)
	{
		for ( var name in v_map ) 
		{
			if (v_map[name] == v_value)
				return name;
		}
		return "unknown";
	};
	
	M.mapToString = function(v_map)
	{
		var v_str = "{";
		for (var v_key in v_map)
		{
			v_str += v_key + ":" + v_map[v_key] + ", ";
		}
		if (v_str.length>2)
			v_str = v_str.substr(0, v_str.length-2);
		v_str += "}";
		return v_str;
	};
	
	/*
	HTML encode a string
	*/
	M.encodeHtml = function(v_str)
	{
		if (!v_str)
			return v_str;
		v_str = v_str.toString();
		v_str = v_str.replace("&", "&amp;");
		v_str = v_str.replace("<", "&lt;");
		v_str = v_str.replace(">", "&gt;");
		v_str = v_str.replace(" ", "&nbsp;");
		v_str = v_str.replace("\"", "&quot;");
		v_str = v_str.replace("'", "&apos;");
		return v_str;		
	};
	
	/*
	HTML decode a string
	*/
	M.decodeHtml = function(v_str)
	{
		if (!v_str)
			return v_str;
		v_str = v_str.toString();
		v_str = v_str.replace("&amp;", "&");
		v_str = v_str.replace("&lt;", "<");
		v_str = v_str.replace("&gt;", ">");
		v_str = v_str.replace("&nbsp;", " ");
		v_str = v_str.replace("&quot;", "\"");
		v_str = v_str.replace("&apos;", "'");
		return v_str;		
	};
	
	/*
	 * Log a debugging message
	 */
	M.log = function(v_level, v_msg, v_optsource)
	{
		if (!v_optsource) v_optsource = "data";
		if(v_pub.i.callback.log)
			v_pub.i.callback.log(v_msg, v_level, v_optsource); // put the level at the end, just in case the callback only uses one param
		/*else
		{
			try { console.log(v_optsource + " [" + v_level + "] " + v_msg); } catch(e) {}
		}*/
	};
	
	/*
	 * Log a debugging message
	 */
	M.logError = function(v_dataItem, v_msg)
	{
		M.log(LL_ERROR, "Error: " + v_msg + " in: " + v_dataItem);
		M.setErrorStatus(v_dataItem, C_DatError.InvalidArg, v_msg);		
	};
	
	/*
	*/
	M.send = function(v_type, v_header, v_body)
	{
		if (!M.m_loginSent)
			// set up a login
			M.sendLogin();
		
		v_pub.stream.send(v_type, v_header, v_body);
	};
	
	/*
	* Sends login credentials to the server
	*/
	M.sendLogin = function()
	{
		M.log(LL_INFORMATION, "Sending login info");
		var v_header = [C_DatKey.Protocol, C_DAT_PROTOCOL_VERSION, 
						C_DatKey.Application, "data.js"];
		M.m_loginSent = true;
		if (v_pub.i.callback.userName)
			v_header.push(C_DatKey.Username, v_pub.i.callback.userName);
		if (v_pub.i.callback.password)
			v_header.push(C_DatKey.Password, v_pub.i.callback.password);
		v_pub.stream.send(C_DatMsg.C_Login, v_header, null);	// don't use M.send here
	};


	/*
	* Generic, centralised request mechanism
	*/	
	M.openRequest = function(v_dataItem, v_header, v_typeStr, v_requestParams)
	{
		if (v_dataItem.v_id)
			throw v_typeStr + " request is aleady open.";
		
		v_dataItem.m_requestParams = v_requestParams;
		v_dataItem.v_id = M.m_nextRequestId++;
		v_dataItem.v_typeStr = v_typeStr;
		
		M.log(LL_INFORMATION, "Requesting " + v_typeStr + ": " + v_dataItem);
		M.setItemStatus(v_dataItem, C_DatState.Pending, C_DatError.None);
		
		// add the requestid as a tag
		v_header.push(C_DatKey.Tag, v_dataItem.v_id);
		
		// store the header for later (for disconnects/reconnects)
		v_dataItem.m_header = v_header;
		
		// start the request
		M.send(C_DatMsg.C_Subscribe, v_header, null);
		
		// store the request for later access
		M.m_requests[v_dataItem.v_id] = v_dataItem;
	};
	
	/*
	* generic, centrallised close request
	*/
	M.closeRequest = function(v_dataItem)
	{
		if (!v_dataItem.v_id)
			return;
			
		// add the requestid as a tag
		var v_header = [ C_DatKey.Tag, v_dataItem.v_id ];
		
		// start the request
		v_pub.stream.send(C_DatMsg.C_Unsubscribe, v_header, null);
		
		// remove the request from the central location
		// so that any errant messages for this item will be rejected
		M.m_requests[v_dataItem.v_id] = v_undefined;
		v_dataItem.v_id = v_undefined;
		M.setItemStatus(v_dataItem, C_DatState.Closed, C_DatError.None);
	};
	
	/*
	* connect/disconnect notifications from cogstream
	*/
    M.onStreamConnected = function() 
    {
		M.log(LL_INFORMATION, "Connected");
		
		// Cancel the reconnect timer
		M.stopReconnectTimer();
		
		M.m_bConnected = true;
		M.setConnectionStatus(C_DatState.Live, C_DatError.None);
		if (v_pub.i.callback.onConnected)
			v_pub.i.callback.onConnected();
			
		if (!M.m_loginSent)
			// set up a login
			M.sendLogin();
			
		// fire up all the requests that are outstanding
		for (var v_id in M.m_requests)
		{
			if (M.m_requests[v_id])
			{
				// start the request (again)
				//var v_dataItem = M.m_requests[v_id];
				//M.log(LL_INFORMATION, "Requesting " + v_dataItem.v_typeStr + ": " + v_dataItem);
				v_pub.stream.send(C_DatMsg.C_Subscribe, M.m_requests[v_id].m_header, null);
			}
		}
    };
    
    M.onStreamDisconnected = function()
    {
		if (M.m_bConnected)
			M.setConnectionStatus(C_DatState.Closed, C_DatError.None, "Disconnected");
		else
			M.setConnectionStatus(C_DatState.Closed, C_DatError.None, "Failed to connect");
		for (var v_id in M.m_requests)
		{
			if (M.m_requests[v_id])
				M.setItemStatus(M.m_requests[v_id], C_DatState.Closed, C_DatError.None);
		}
		M.m_bConnected = false;
	    M.m_loginSent = false;
		if (v_pub.i.callback.onDisconnected)
			v_pub.i.callback.onDisconnected();
			
		// start the reconnect timer
		M.startReconnectTimer();
    };
	
	
	/*
	 * Start the reconnect timer
	 */
	M.startReconnectTimer = function()
	{
		//M.log(LL_TRACE2, "startReconnectTimer");
		// Cancel the old timer
		if(M.timer)
			M.win.clearTimeout(M.timer);

		// Start the timer
		M.timer = M.win.setTimeout(M.onReconnectTimer, 10 * 1000);
	};
	
	/*
	 * Stops the reconnect timer
	 */
	M.stopReconnectTimer = function()
	{
		//M.log(LL_TRACE2, "stopReconnectTimer");
		if(M.timer)
			M.win.clearTimeout(M.timer);
		M.timer = 0;
	};
	
	/*
	 * Reconnect Timer callback. If we haven't connected yet... try again
	 */
	M.onReconnectTimer = function()
	{
		M.timer = 0;
		//M.log(LL_TRACE2, "onReconnectTimer:" + M.m_bConnected);
		if (!M.m_bConnected)
		{
			M.log(LL_INFORMATION, "Reconnecting...");
			M.setConnectionStatus(C_DatState.Pending, C_DatError.None);
			v_pub.stream.connect();
		}
	};
	
	/*
	* master callback message cracking from cogstream
	*/
	M.onMsg = function(v_msgType, v_header, v_body)
	{
		//M.log(LL_TRACE3, "msgtype:'" + M.enumLookupString(v_msgType, C_DatMsg) + "' hdr:'" + v_header + "' body:'" + v_body + "'");
		
		var v_hdrmap = M.arrayToMap(v_header);
		var v_tag = v_hdrmap[C_DatKey.Tag]; // get the tag if we can
		
		// grab the dataitem, using the tag, if we can
		var v_dataItem = null;
		if (v_tag) 
			v_dataItem = M.m_requests[v_tag];
		if (v_dataItem && !v_dataItem.P_decode)
			v_dataItem = null;
		if (!v_dataItem) 
			v_dataItem = null;
		
		switch (v_msgType)
		{
			case C_DatMsg.C_Login:
				{
					v_pub.serverVersion = v_hdrmap[C_DatKey.Protocol];
					v_pub.serverApplication = v_hdrmap[C_DatKey.Application];
					M.log(LL_INFORMATION, "login complete: serverVersion=" + v_pub.serverVersion + " serverApplication='" + v_pub.serverApplication + "'");
				}
				break;
				
			case C_DatMsg.C_Subscribe:
			case C_DatMsg.C_Unsubscribe:
			case C_DatMsg.C_Mount:
			case C_DatMsg.C_Dismount:
				// do nothing
				//M.log("msgtype:'" + M.enumLookupString(v_msgType, C_DatMsg) + "' hdr:'" + v_header + "' body: '" + v_body + "'");
				break;
			
			case C_DatMsg.C_Image: // fall thru
				//M.log("msgtype:'" + M.enumLookupString(v_msgType, C_DatMsg) + "' hdr:'" + v_header + "' body: '" + v_body + "'");
			
			case C_DatMsg.C_Update:
				{
					if (v_dataItem)
					{
						if (v_dataItem.state!=C_DatState.Live) 
							M.setItemStatus(v_dataItem, C_DatState.Live, C_DatError.None);
						v_dataItem.P_decode.call(v_dataItem, v_msgType==C_DatMsg.C_Image, v_header, v_body);
					}
					else
						M.log(LL_WARNING, "ignoring unknown data");
				}
				break;
				
			case C_DatMsg.C_Status:
				{
					var v_state = v_hdrmap[C_DatKey.State];
					var v_error = v_hdrmap[C_DatKey.Error];
					if (!v_dataItem && !v_tag)
						// not for an item (and was never intended to be)....must be connection status
						M.setConnectionStatus(v_state, v_error);
					else					
						// yes, we can be here with a null v_dataItem. this is by design
						M.setItemStatus(v_dataItem, v_state, v_error);
				}
				break;
				
			case C_DatMsg.C_Error:
				{
					M.setErrorStatus(v_dataItem, v_hdrmap[C_DatKey.Error]);
				}
				break;
		}
	};
	
	/********************************************
	* Dictionary object
	*********************************************/
	M.dictionaryItem = function()
	{
		this.m_name=v_undefined;
		this.m_type=v_undefined;
		this.m_description=v_undefined;
		this.m_aliases=v_undefined;
	};
	
	M.dictionaryItem.prototype.toString = function()
	{
		var v_str = this.m_name + "(" + M.enumLookupString(this.m_type, C_DatType) + ") ";
		if (this.m_description)
			v_str += " " + this.m_description;
		if (this.m_aliases)
			v_str += " " + this.m_aliases;
		return v_str;
	};
	
	
	M.initDictionary = function()
	{
		M.initDataItem.call(this);
		this.m_items = {}; // a map of key to dictionaryItem
		this.m_names = v_undefined; // a map of field name to key
		this.P_subscribe = M.subscribeDictionary; // obfuscate the request
		this.P_decode = M.decodeDictionary; // obfuscate the decoder
		this.getName = M.getDictionaryName;
		this.getDescription = M.getDictionaryDescription;
		this.getType = M.getDictionaryType;
		this.findKey = M.findDictionaryKey;
		this.P_buildDictionaryNames = M.buildDictionaryNames;
	};
	
	M.getDictionaryName = function(v_key)
	{
		return this.m_items[v_key].m_name;
	};
	
	M.getDictionaryDescription = function(v_key)
	{
		return this.m_items[v_key].m_description;
	};
	
	M.getDictionaryType = function(v_key)
	{
		return this.m_items[v_key].m_type;
	};
	
    M.buildDictionaryNames = function() 
	{
        this.m_names = {};
        for (var v_key in this.m_items) {
            var v_item = this.m_items[v_key];
            this.m_names[v_item.m_name.toLowerCase()] = v_key;
            if (v_item.m_aliases)
            for (var v_i=0; v_i<v_item.m_aliases.length; v_i++) {
	            this.m_names[v_item.m_aliases[v_i].toLowerCase()] = v_key;
            }
        }
        M.log(LL_TRACE1, "Build dictionary names");
    };
    
    M.findDictionaryKey = function(v_name) // returns integer key, or exception if not found
    {
        v_name = v_name.toLowerCase();
		if (!this.m_names) 
			this.P_buildDictionaryNames();
		var v_item = this.m_names[v_name];
		if (v_item)
			return parseInt(v_item);
        throw "not found";
    };
	
	
	/*
	* starts a dictionary request
	*/	
	M.subscribeDictionary = function(v_params) 
	{ 
		if (!v_params) // allow params to be specified at time of calling the request
			v_params = {};
			
		if (!v_params.source) 
			v_params.source = v_pub.i.callback.source || "";
			
		if (v_params.source == "") 
			throw "No source defined";
		
		var v_header = [C_DatKey.Source, v_params.source, 
						C_DatKey.Item, C_DAT_ITEM_DICT, 
						C_DatKey.Filter, "*"];
					
		M.m_dictionaries[v_params.source] = this;				
		M.openRequest(this, v_header, "Dictionary", v_params); 
	};	
	
	/*
	* Dictionary message cracker
	*/	
	M.decodeDictionary = function(v_bImage, v_header, v_body)
	{
		this.m_names = v_undefined; // throw out our name lookup map
		
		for (var v_i=0; v_i<v_body.length-1; v_i+=2)
		{
			var v_key   = v_body[v_i];
			var v_value = v_body[v_i+1];
			//M.log(LL_TRACE3, "Dict val. key:" + v_key + " val:" + v_value.substr(2) + " op:" + v_value.charAt(1));
			
			// Handle the normal case first. If the string does not start
			// with an escape character, it's a normal set field.
			if(v_value.length<2)
			{
				M.logError(this, "Invalid dictionary operation");
				return false;
			}
			
			if (!this.m_items[v_key])
			{
				// create the key entry
				//M.log("created dict entry for key " + v_key);
				this.m_items[v_key] = new M.dictionaryItem();
			}
				
			var v_str = v_value.substr(2);

			// Otherwise handle it according to the opcode
			
			switch(v_value.charAt(1))
			{
				case 'n':
					//M.log("key " + v_key + " = " + v_str);
					this.m_items[v_key].m_name = v_str;
					break;

				case 'd':
					//M.log("key " + v_key + " = " + v_str);
					this.m_items[v_key].m_description = v_str;
					break;
					
				case 't':
					{
						var type = parseInt(v_str);
						//M.log("key " + v_key + " type = " + type);
						
						if(type < C_DatType.None ||
							type > C_DatType.DateTime)
						{
							M.logError(this, "Invalid dictionary type");
							return false;
						}
						this.m_items[v_key].m_type = type;
					}
					break;
					
                case 'a':
                    { // Aliases
                        var v_ar = v_str.split(",");
                        if (!v_ar) v_ar = new Array();
                        this.m_items[v_key].m_aliases = v_ar;
                    }
                    break;
				default:
					M.logError(this, "Unknown dictionary update type: " + v_value.charAt(1));
					return false;
			}
		}

		M.log(LL_TRACE, "dictionary: " + this);
	};
	
	/*********************************************
	* Generic DataItem object
	*********************************************/
	M.initDataItem = function()
	{
		this.m_requestParams = v_undefined;
		this.getRequestParams = M.getRequestParams;
		this.getSource = M.getSource;
		this.getSymbol = M.getSymbol;
		this.getParams = M.getParams;
		this.getFilter = M.getFilter;
	};

	M.getRequestParams = function()
	{
		return this.m_requestParams;
	};
	
	M.getSource = function()
	{
		return this.m_requestParams.source;
	};
	
	M.getSymbol = function()
	{
		return this.m_requestParams.symbol;
	};
	
	M.getParams = function()
	{
		return this.m_requestParams.params;
	};

	M.getFilter = function()
	{
		return this.m_requestParams.filter;
	};
	
	/*********************************************
	* Record object
	*********************************************/
	
	/*
	*
	*/
	M.initRecord = function()
	{
		M.initDataItem.call(this);
		this.dictionary = v_undefined; // allow a manual dictionary to be set
		this.cacheData = v_pub.i.callback.cacheData || true;
		this.useDictionary = v_pub.i.callback.useDictionary || true;
		this.m_fields = {};
		this.m_aliasKeys = v_undefined; // used to map keys to aliases (only when using filters)
		
		this.subscribe = M.subscribeRecord;
		this.unsubscribe = function() { M.closeRequest(this); };
		this.P_decode = M.decodeRecord; // obfuscate the decoder
		this.getFieldValue = M.getFieldValue;
		this.getFields = M.getFields;
		return this; 
	};
	
	M.getFieldValue = function(v_key)
	{
		var v_value = this.m_fields[v_key];
		if (!v_value) 
			// try again, using lowercase name
			v_value = this.m_fields[v_key.toLowerCase()];
		return v_value;
	};
	
	M.getFields = function()
	{
		return this.m_fields;
	};
	
	/*
	* called when an record updates/has a new image
	*/
	M.onRecordUpdate = function(v_record, v_bImage, v_fields)
	{
		if (v_record.m_requestParams.onUpdate) // call a local update handler, if specified
			v_record.m_requestParams.onUpdate(v_record, v_bImage, v_fields);
		else
		if (v_pub.i.callback.onRecordUpdate) // call the global record handler, if specified
			v_pub.i.callback.onRecordUpdate(v_record, v_bImage, v_fields);
	};
	
	/*
	* starts a record request
	*/	
	M.subscribeRecord = function(v_params) 
	{ 
		if (!v_params) // allow params to be specified at time of calling the request
			throw "No request params specified";
			
		if (!v_params.source) v_params.source = v_pub.i.callback.source || "";
		if (!v_params.symbol) v_params.symbol = "";
		if (!v_params.filter) v_params.filter = "";
		if (!(v_params.useDictionary==v_undefined)) this.useDictionary = v_params.useDictionary;
		if (v_params.cacheData) this.cacheData = v_params.cacheData;
		if (v_params.dictionary) { this.dictionary = v_params.dictionary; this.useDictionary=true; }

		// If conflation is undefined, first try the conflation value from data.init.
		// If that is also undefined, used the default C_DefaultConflation.
		if (v_params.conflation == v_undefined) 
			v_params.conflation = v_pub.i.callback.conflation;
		if(v_params.conflation == v_undefined)
			v_params.conflation = C_DefaultConflation;
		
		if (v_params.source == "") throw "No source defined";
		if (v_params.symbol == "") throw "No symbol defined";
		
		if (this.useDictionary)
		{
			// see if there is a dictionary already available
			var v_dict = M.m_dictionaries[v_params.source];
			
			if (!v_dict) // start a dictionary request
			{
				M.log(LL_TRACE, "Starting dictionary request " + v_dict);
				v_dict = new v_pub.dictionary();
				v_dict.P_subscribe({source:v_params.source});
			}
			
			this.dictionary = v_dict;			
		}
		
		var v_header = [C_DatKey.Source, v_params.source, 
						C_DatKey.Item, v_params.symbol, 
						C_DatKey.Conflation, v_params.conflation];
		if (v_params.filter && v_params.filter.length>0)
			v_header.push(C_DatKey.Filter, v_params.filter);		
		M.openRequest(this, v_header, "Record", v_params); 
	};
	
	/*
	* Record message cracker
	*/	
	M.decodeRecord = function(v_bImage, v_header, v_body)
	{
		var v_updates = {};
		for (var v_i=0; v_i<v_body.length; v_i+=2)
		{
			var v_key   = v_body[v_i];
			if (this.useDictionary)
			{
				// map the key to an actual string name
				
				if (!this.m_aliasKeys) // 1st time only, build a map of field name to key
				{
					this.m_aliasKeys = {};
					
					if (this.getFilter())
					{
						// using the filter list, build the list of keys we should expect for each of those fields
						// This makes mapping a field alias (eg LAST) to the correct key, easily.
						var v_ar = this.getFilter().split(",");
						for (var v_j=0; v_j<v_ar.length; v_j++)
						{
							try {
							var v_alias = v_ar[v_j];
							var v_aliasKey = this.dictionary.findKey(v_alias);
							this.m_aliasKeys[v_aliasKey] = v_alias;
							}
							catch (e) 
							{ 
								// ignore any error, probably a bad field/alias name
								M.logError(this, "Field '" + v_alias + "' not found in dictionary");
							} 
						}
					}
				}
			
								
				var v_keyname = this.m_aliasKeys[v_key];
				
				if (!v_keyname)
				{
					var v_dictitem = this.dictionary.m_items[v_key]; // this is a last ditch effort and will probably fail
					if (v_dictitem)
						v_keyname = v_dictitem.m_name;
					if (!v_keyname)
						v_keyname = "Unk" + v_key;
				}
					
				v_key = v_keyname;				
			}
			
			var v_value = v_body[v_i+1] + "";
			
			// Handle the normal case first. If the string does not start
			// with an escape character, it's a normal set field.
			if(v_value == "" || v_value.charAt(0) != '#')
			{
				//M.log("decoded simple key:" + v_key + " val:" + v_value);
				v_updates[v_key] = v_value;
				if (this.cacheData)
					this.m_fields[v_key] = v_value;
				continue;
			}

			// Make sure there is an opcode (character after the #)

			if(v_value.length == 1)
			{
				M.logError(this, "Missing opcode in record update");
				return false;
			}

			// Otherwise handle it according to the opcode
			
			switch(v_value.charAt(1))
			{
				case 'd':
					//M.log("decoded key delete:" + v_key);
					v_updates[v_key] = v_undefined; // can't actually delete in javascript
					if (this.cacheData)
						this.m_fields[v_key] = v_undefined;
					break;

				case 'p':
					{
						if (!this.cacheData)
						{
							M.logError(this, "partial update not supported with caching off");
							return false;
						}
						
						// Skip past the #p
						var v_str = v_value.substr(2);
						
						// Split the remainder at the first ':'
						var v_ar = v_str.split(";");
						if (v_ar.length!=2)
						{
							M.logError(this, "Missing separator in partial update");
							return false;
						}

						// Parse the position integer
						var v_pos = -1; 
						try { v_pos = CInt(v_ar[0]); } catch(e) { v_pos=-1; }
					
						if(v_pos < 0)
						{
							M.logError(this, "Invalid position in partial update");
							return false;
						}
						
						v_value = v_ar[1];
						//M.log("decoded partial key:" + v_key + " val:" + v_value + " pos:" + v_pos + " current:" + this.m_fields[v_key]);

						// Apply the update
						var v_current = this.m_fields[v_key];
						if (!v_current && v_pos==0)
						{
							v_updates[v_key] = v_value;
							if (this.cacheData)
								this.m_fields[v_key] = v_value;
						}
						else
						if (v_current && v_current.length>=v_value.length+v_pos) 
						{
							v_value = v_current.substr(0,v_pos) + v_value + v_current.substr(v_pos+v_value.length);
							v_updates[v_key] = v_value;
							if (this.cacheData)
								this.m_fields[v_key] = v_value;
						}

					}
					break;
				
				case '#':
					{
						// Skip past the ##
						v_value = v_value.substr(2);
						//M.log("decoded ## key:" + v_key + " val:" + v_value);
						v_updates[v_key] = v_value;
						if (this.cacheData)
							this.m_fields[v_key] = v_value;
					}
					break;

				default:
					M.logError(this, "Unknown record update type: " + v_value.charAt(1));
					return false;
			}
		}
		
		M.onRecordUpdate(this, v_bImage, v_updates);
	};
	
	
    /*
    * The master initialisation func
    */	
	v_pub.init = M.init;
	
	/*
	* Public functions
	*/
    v_pub.connect = M.connect;
    v_pub.disconnect = M.disconnect;

	/*
	* public datatype definitions
	*/
	v_pub.record = M.initRecord;
    v_pub.record.prototype.toString = function() 
    { 
		return this.m_requestParams.source + " " + this.m_requestParams.symbol + " " + this.m_requestParams.filter + " " + M.mapToString(this.m_fields);
	};
	
	v_pub.dictionary = M.initDictionary;
	v_pub.dictionary.prototype.toString = function() 
	{
		return this.m_requestParams.source + " " + M.mapToString(this.m_items);
	};
	
    /*
    * Public Enumerations
    */	
	v_pub.DatFormat = C_DatFormat;
	v_pub.DatState = C_DatState;
	v_pub.DatError = C_DatError;
	v_pub.DatType = C_DatType;

    /*
    * Public Vars
    */	
	v_pub.serverVersion = v_undefined;
	v_pub.serverApplication = v_undefined;
	v_pub.stream = v_undefined; // undefined until init is called
	
	/*
	* Misc helper functions
	*/
	v_pub.utils = {};
	v_pub.utils.arrayToMap = M.arrayToMap;
	v_pub.utils.enumLookupString = M.enumLookupString;
	v_pub.utils.mapToString = M.mapToString;
	v_pub.utils.decodeHtml = M.decodeHtml;
	v_pub.utils.encodeHtml = M.encodeHtml;

	
	/*
	* Internal (aka pseudo public) objects/enums/properties
	*/
	v_pub.i = {};
	v_pub.i.DatKey = C_DatKey;
	v_pub.i.send = M.send;
	v_pub.i.openRequest = M.openRequest;
	v_pub.i.closeRequest = M.closeRequest;
	v_pub.i.setItemStatus = M.setItemStatus;
	v_pub.i.getDefaultConflation = function() { return C_DefaultConflation; };
	v_pub.i.initDataItem;
	v_pub.i.callback = { }; // this is set during data.init() to user's options
	v_pub.i.log = M.log;
	
	// register with the main window
	var v_olddata = window.data; // save any previous 'data' configuration
	v_pub.olddata = function() { return v_olddata; };
	window.data = v_pub;
})();
/*
 * data.dom.js  
 * DOM traversal code
 */
//grob:prefixes=C_,v_,m_,F_,LL_
//grob:namespaces=M


/*
Callback functions:
onUpdate( elem, dataItem, fieldName, value, bImage); // 'this' also points to the HTML elem
onStatus( elem, dataItem, state, error, errorMessage); // 'this' also points to the HTML elem
        
eg:


function updateHandler(elem, dataItem, fieldName, value, bImage) 
{
	elem.innerHTML = value;
}

function imageHandler(img, value)
{
	img.src = value>0 ? "up.png" : "down.png";
}

function stateHandler(elem, dataItem, state, error, text) 
{ 	
	//elem.innerHTML = 
}

function startup()
{
	data.init();
	data.connect();
	data.parseDOM(document.body, { onUpdate:updateHandler, onStatus:stateHandler });
}
. . .

<html>
<div source="IDN_RDF" symbol="BHP.AX">
	<span field="Last" /><span field="Bid" /><span field="Ask"><img field="NETCHANGE" onupdate="imageHandler(this, value);" />
</div>
</html>
*/

/*
 * Create v_attrib new ValueAnimation object
 */
(function()
{
	/*
	* Log Levels (defined in stream.js, redefined here for better obfuscation)
	*/
    var LL_ERROR        = LogLevel.ERROR;
	var LL_WARNING		= LogLevel.WARNING;
	var LL_INFORMATION	= LogLevel.INFORMATION;
	var LL_TRACE		= LogLevel.TRACE;
	var LL_TRACE1		= LogLevel.TRACE1;
	var LL_TRACE2		= LogLevel.TRACE2;
	var LL_TRACE3		= LogLevel.TRACE3;
	
	
	
	if (!window.data)
	{
		alert("include data.js first");
		return;
	};
	/*
	public interface
	*/
	var v_pub = window.data;
	
	var C_undefined;
	
	/*
	 * Members
	 */
	var M = 
	{
		m_requests:{},
		m_lastRequestId:0,
		m_win:null
	};
	

	M.log = function(v_level, v_msg)
	{
		v_pub.i.log(v_level, v_msg, "dom");
	};
	
	/*
	Appends the given style at the end. If already applied in the middle, it is removed and added at the end
	*/
	M.applyStyle = function(v_elem, v_className)
	{
		if (!v_elem || !v_className || v_className.length<1)
			return;
		var v_str = "";
		if (v_elem.className)
		{
			var v_a = v_elem.className.split(" ");
			for (var v_pos in v_a)
			{ 
				if (v_a[v_pos]!=v_className && v_a[v_pos].length>0)
					v_str += v_a[v_pos] + " "; 
			};
		}
		v_str += v_className;
		v_elem.className = v_str;
	};
	
	/*
	* Given a list of styles on an element, removes v_className 
	*/
	M.removeStyle = function(v_elem, v_className)
	{
		if (!v_elem || !v_className || v_className.length<1 || !v_elem.className)
			return;
		var v_a = v_elem.className.split(" ");
		var v_str = "";
		for (var v_pos in v_a)
		{ 
			if (v_a[v_pos]!=v_className && v_a[v_pos].length>0)
				v_str += v_a[v_pos] + " "; 
		};
		v_str = v_str.replace(/((\s*\S+)*)\s*/, "$1"); // trim right
		v_elem.className = v_str;
	};
	
	M.defaultUpdateHandler = function(elem, record, fieldName, value, bImage) 
	{
		elem.innerHTML = value;
	};
	
	M.defaultStateHandler = function(elem, dataItem, state, error, text)
	{
		if (state!=v_pub.DatState.Live) 
			M.applyStyle(elem,"priceStale");
		else 
			M.removeStyle(elem,"priceStale");
	};

	
	//	example:	
	//		var id1=parseDOM(document.getElementById("table1"));
	//		commit();
	//		...
	//		cancel(id1);
	//		commit();
	M.parseDOM = function(v_body, /* optional: */ v_options) 
	{
	    M.log(LL_TRACE, "parsing DOM");
		if (!v_body)
			v_body = document.body;

		var v_request = {
			m_records:{},
			m_tables:{}
		};	
			
		var _this=this;
		try {
			if (v_body.ownerDocument.defaultView) 
				m_win = v_body.ownerDocument.defaultView; 
			else 
				m_win = v_body.ownerDocument.parentWindow;
		} 
		catch (er) 
		{
			m_win=window;
		}
		
		// scan the DOM	
		if (!v_options) v_options = {};
		if (!v_options.onUpdate) 
		{
			M.log(LL_INFORMATION, "Using default DOM update handler");
			v_options.onUpdate = M.defaultUpdateHandler;
		}
		if (!v_options.onStatus) 
		{
			M.log(LL_INFORMATION, "Using default DOM state handler");
			v_options.onStatus = M.defaultStateHandler;
		}

		M.goDom(v_request, v_body, v_options.onUpdate, v_options.onStatus, 
			v_options.source, v_options.symbol, v_options.field, 
			v_options.dataFormat, v_options.colIndex, v_options.rowIndex, 
			v_options.conflation);
		
		// now, request all the items....
		M.log(LL_INFORMATION, "DOM parsed ok. Requesting data...");
		
		// ...records first
		for(var v_key in v_request.m_records)
		{
			//M.log(LL_TRACE2, "record " + v_key);
			var v_rec = v_request.m_records[v_key];
			var v_bAllNumeric=true;
			var v_fields = "";
			for (var v_f in v_rec.m_fields)
			{
				if (v_fields.length>0) v_fields += ",";
				v_fields += v_f;
				try{
					var v_fieldId = parseInt(v_f);
					if (!v_fieldId)
						v_bAllNumeric = false;
				}
				catch(e){ v_bAllNumeric = false; }
			}
			//M.log(LL_TRACE2, "Record " + v_rec.m_symbol + " useDictionary:" + !v_bAllNumeric);
			if (v_rec.m_req)
				v_rec.m_req.unsubscribe();
			v_rec.m_req = new data.record();
			v_rec.m_req.m_record = v_rec; // create a circular reference for easy updating
			v_rec.m_req.subscribe({
				source:v_rec.m_source,
				symbol:v_rec.m_symbol,
				conflation:v_rec.m_conflation,
				useDictionary:!v_bAllNumeric,
				filter:v_fields,
				onUpdate:M.onRecordUpdate,
				onStatus:M.onStatus
				});
		}
		
		for (var v_key in v_request.m_tables)
		{
			var v_table = v_request.m_tables[v_key];
			if (v_table.m_req)
				v_table.m_req.unsubscribe();
			v_table.m_req = new data.table();
			v_table.m_req.m_table = v_table; // create a circular reference for easy updating
			v_table.m_req.subscribe({
				source:v_table.m_source,
				symbol:v_table.m_symbol,
				conflation:v_table.m_conflation,
				//onBeginUpdate:M.onBeginTableUpdate,
				onCellChanged:M.onCellChanged,
				onStatus:M.onStatus
				});
		}
	
		M.m_requests[++M.m_lastRequestId] = v_request;
		return M.m_lastRequestId;
	};
		
	var C_undefined;
	M.goDom = function(v_request, v_elem, v_onUpdate, v_onStatus, v_source, v_symbol, v_field, v_dataFormat, v_colIndex, v_rowIndex, v_conflation) 
	{
			var v_n=0; var v_m=0;

			F_getAttr = function(v_name, v_transform, v_default) 
			{
				try {
					var a=v_elem.getAttribute(v_name);										
					if (a) 
					{
						if (v_transform) 
						{
							/* 
								see https://developer.mozilla.org/en/Core_JavaScript_1.5_Reference/Global_Objects/Function
								ie. new Function('elem','dataItem','fieldName','value','bImage',a)
									where 'a' is the body of the function.
							*/
							v_m++; 
							return eval(v_transform);
						} 
						else 
						{
							v_n++;	
							return a;	
						}
					}
				} catch (err) {	} 					
				return v_default;
			};
				
	
	
		try
		{
			v_source=F_getAttr("source", C_undefined, v_source);
			v_symbol=F_getAttr("symbol", C_undefined, v_symbol);
			if (!v_symbol) v_symbol=F_getAttr("item", C_undefined, v_symbol);
			v_field=F_getAttr("field", C_undefined, v_field);
			v_colIndex = F_getAttr("colIndex", C_undefined, v_colIndex );
			v_rowIndex = F_getAttr("rowIndex", C_undefined, v_rowIndex );
			v_dataFormat=F_getAttr("dataFormat", C_undefined, v_dataFormat);	
			v_conflation = F_getAttr("conflation", C_undefined, v_conflation);
			v_onUpdate=F_getAttr("onupdate","new Function('elem','dataItem','fieldName','value','bImage',a)", v_onUpdate);
			v_onStatus=F_getAttr("onstatus","new Function('elem','dataItem','state','error','errorMessage',a)", v_onStatus);
			//var modelName=F_getAttr("modelName");
			//M.log(LL_TRACE, "goDom. src:'"+v_source+"' symb:'"+v_symbol+"' fld='"+v_field+"' ci='"+v_colIndex+"' ri='"+v_rowIndex+"' fmt='"+v_dataFormat+"'");
			
			// Manually construct the v_field attribute if v_attrib row and column have been specified.
			if (!v_field && v_colIndex && v_rowIndex && v_dataFormat==data.DatFormat.Table)
				v_field = "R"+v_rowIndex+"C"+v_colIndex;
			    
			var bRecurse = true;
			//if (modelName)
			//	{
			//	var cons = eval(modelName);
			//	v_elem.model = new cons(v_elem, v_source, v_symbol, v_field, v_dataFormat, v_onUpdate, v_onStatus);
			//	}
			//else 
			if ((v_n>0||v_m>0)&&v_source&&v_symbol&&v_field) 
			{
				if (v_dataFormat==data.DatFormat.Table)
				{
				// table
					var rAt = 0;
					var cAt = v_field.indexOf("C", rAt+1);
					var row = parseInt(v_field.substr(rAt+1, cAt-rAt-1));
					var col = parseInt(v_field.substr(cAt+1));
					var table = M.getTable(v_request, v_source, v_symbol, v_conflation);
					table.getCell(row,col).push({m_elem:v_elem, m_type:data.DatFormat.Table, F_onUpdate:v_onUpdate, F_onStatus:v_onStatus});
				}
				else
				{
				// record
					var rec = M.getRecord(v_request, v_source, v_symbol, v_conflation);
					rec.getField(v_field).push({m_elem:v_elem, m_type:data.DatFormat.Record, F_onUpdate:v_onUpdate, F_onStatus:v_onStatus});
				}
				
				bRecurse = false;
				// TODO: Add support to recurse into elements that are already defined with a source/item/field?
				//   No need for this can be seen
				
			} 
			
			if (bRecurse)
			for(var i=0;i<v_elem.childNodes.length;i++) 
			{
				if ((v_elem.childNodes[i])&&(v_elem.childNodes[i].nodeType==1))
					M.goDom(v_request, v_elem.childNodes[i], v_onUpdate, v_onStatus, v_source, v_symbol, v_field, v_dataFormat, v_colIndex, v_rowIndex, v_conflation);
			}
		} 
		finally
		{
			//_this.lv--;
		}
	};
	
	/*
	Returns a record object for the specified source/symbol pair
	*/
	M.getRecord = function(v_request, v_source, v_symbol, v_conflation)
	{
		var v_str = v_source + " " + v_symbol + " " + v_conflation;
		var v_rec = v_request.m_records[v_str];
		if (!v_rec)
		{
			//make a new record
			v_rec = { m_source:v_source, m_symbol:v_symbol, m_conflation:v_conflation };
			v_rec.m_fields = {};
			v_rec.getField = M.getField;
			v_request.m_records[v_str] = v_rec;
		}
		return v_rec;
	};
	
	/*
	Returns a list of field recipients for a specific record."this" is a record
	*/
	M.getField = function(v_field)
	{
		v_field = v_field.toLowerCase();
		var v_fieldObj = this.m_fields[v_field];
		if (!v_fieldObj)
		{
			v_fieldObj = new Array();
			this.m_fields[v_field] = v_fieldObj;
		}
		return v_fieldObj;
	};
	
	/*
	returns a table object for the specific source/symbol pair
	*/
	M.getTable = function(v_request, v_source, v_symbol, v_conflation)
	{
		var v_str = v_source + " " + v_symbol + " " + v_conflation;
		var v_table = v_request.m_tables[v_str];
		if (!v_table)
		{
			//make a new table
			v_table = { m_source:v_source, m_symbol:v_symbol, m_conflation:v_conflation };
			v_table.m_rows = new Array();
			v_table.getCell = M.getCell;
			v_request.m_tables[v_str] = v_table;						
		}
		return v_table;
	};
	
	/*
	returns a list of cell recipients for a specific table. "this" is a table
	*/
	M.getCell = function(v_row, v_col)
	{
		// get the row object (an array of cells)
		var v_rowObj = this.m_rows[v_row];
		if (!v_rowObj)
		{
			v_rowObj = new Array();
			this.m_rows[v_row] = v_rowObj;
		}
		// get the cell object (an array of cell update inf)
		var v_cellObj = v_rowObj[v_col];
		if (!v_cellObj)
		{
			v_cellObj = new Array();
			v_rowObj[v_col] = v_cellObj;
		}
		return v_cellObj;
	};
	
	/*
	* Handles generic status updates for a request and distributes them appropriately to each DOM elem
	*/
	M.onStatus = function(v_dataItem, v_state, v_error, v_errMsg)
	{
		if (v_dataItem.m_record)
		{
			// this is a record...send off status updates
			for (var v_field in v_dataItem.m_record.m_fields)
			{
				var v_fieldObj = v_dataItem.m_record.m_fields[v_field];
				for (var v_k in v_fieldObj)
				{
					v_fieldObj[v_k].state = v_state;
					if (v_fieldObj[v_k].F_onStatus) // push the elem as the 'this' AND as the first param
						v_fieldObj[v_k].F_onStatus.call(v_fieldObj[v_k].m_elem, v_fieldObj[v_k].m_elem, v_dataItem, v_state, v_error, v_errMsg);
				}
			}
		}
		else
		if (v_dataItem.m_table)
		{
			// this is a table...send off status updates
			for (var v_row in v_dataItem.m_table.m_rows)
			{
				var v_rowObj = v_dataItem.m_table.m_rows[v_row];
				for (var v_col in v_rowObj)
				{
					var v_cell = v_rowObj[v_col];
					for (var v_k in v_cell)
					{
						v_cell[v_k].state = v_state;
						if (v_cell[v_k].F_onStatus)// push the elem as the 'this' AND as the first param
							v_cell[v_k].F_onStatus.call(v_cell[v_k].m_elem, v_cell[v_k].m_elem, v_dataItem, v_state, v_error, v_errMsg);
					}
				}
			}
		}
	};
	
	/*
	* central record update facility where updates are distributed to each DOM element that has it defined
	*/
	M.onRecordUpdate = function(v_record, v_bIsImage, v_fields) 
	{
		for (v_field in v_fields)
		{
			var v_fieldObj = v_record.m_record.getField(v_field);
			for (var v_k in v_fieldObj)
			{
				//M.log(LL_TRACE2, v_k + "");
				if (v_fieldObj[v_k].F_onUpdate) // push the elem as the 'this' AND as the first param
					v_fieldObj[v_k].F_onUpdate.call(v_fieldObj[v_k].m_elem, v_fieldObj[v_k].m_elem, v_record, v_field, v_fields[v_field], v_bIsImage);
			}
		}
	};
	

	/*
	Central table cell update facility.
	*/
	M.onCellChanged = function(v_table, v_row, v_col, v_value, v_bIsImage)
	{
		var v_cell = v_table.m_table.getCell(v_row, v_col);
		if(v_cell == null)
			return;
		for (var v_k in v_cell)
		{
			if (v_cell[v_k].F_onUpdate) // push the elem as the 'this' AND as the first param
				v_cell[v_k].F_onUpdate.call(v_cell[v_k].m_elem, v_cell[v_k].m_elem, v_table, "R" + v_row + "C" + v_col, v_value, v_bIsImage);
		}
	};

	/*
	 * Cancel a request
	 */
	M.cancelDOM = function(v_id)
	{
		var v_request = M.m_requests[v_id];
		if(!v_request) {
			return;
		}

		for(var v_key in v_request.m_tables) {
			var v_table = v_request.m_tables[v_key];
			v_table.m_req.unsubscribe();
		}	
		
		for(var v_key in v_request.m_records) {
			var v_record = v_request.m_records[v_key];
			v_record.m_req.unsubscribe();
		}	

		// Remove from the map
		delete M.m_requests[v_id];
	};	

	v_pub.parseDOM = M.parseDOM;	
	v_pub.cancelDOM = M.cancelDOM;

	/* These functions are now deprecated */
	v_pub.getDOMRecords = function() { };
	v_pub.getDOMTables = function() { };
})();

/*
 * data.tablejs  (requires stream.js)
 * Data Table Layer
 *
 Callback functions (defined during the request)
		onStatus(table, state, error, errorMsg)
		onBeginUpdate(table, image)
		onEndUpdate(table, image)
		onColumnAdded(table)
		onColumnNameChanged(table, index, name)
		onColumnTypeChanged(table, index, type)
		onColumnRemoved(table, index)
		onAllColumnsRemoved(table)
		onColumnMoved(table, indexFrom, indexTo)
		onRowAdded(table)
		onRowNameChanged(table, index, name)
		onRowRemoved(table, index)
		onAllRowsRemoved(table)
		onRowsMoved(table, indexFrom, indexTo)
		onCellDataChanged(table, rowIndex, colIndex, value)
		onCellChanged(table, rowIndex, colIndex, value)
 
 */
//grob:prefixes=C_,v_,m_
//grob:namespaces=M

(function()
{
	var v_pub = window.data; // the public 'interface'. This is exposed as 'window.data'
	if (!v_pub)
	{
		alert("include data.js first");
	}

	var M = {};
	var v_undefined;
	
	/*
	 * Opcodes for table messags
	 */
	var C_DatTableOp =
	{
		AddColumn			: 1,
		SetColumnType		: 2,
		SetColumnName		: 3,
		SelectColumn		: 4,
		DeleteColumn		: 5,
		DeleteAllColumns	: 6,
		MoveColumn			: 7,
		AddRow				: 8,
		SetRowName			: 9,
		SelectRow			: 10,
		DeleteRow			: 11,
		DeleteAllRows		: 12,
		MoveRow				: 13,
		SetUserData			: 14,
		SetCell				: 32
	};
	
	
	/*********************************************
	* Utils
	*********************************************/
	M.arrayRemoveAt = function(v_array, v_index)
	{
		var v_a = new Array();
		for (var v_i=0; v_i<v_array.length; v_i++)
		{
			if (v_i!=v_index)
				v_a.push(v_array[v_i]);
		}
		return v_a;
	};
	
	M.arrayMove = function(v_array, v_indexFrom, v_indexTo)
	{
		if (v_indexFrom==v_indexTo)
			return v_array;
		var v_a = new Array();
		var v_val = v_array[v_indexFrom]; //save the value
		if (v_indexTo>v_indexFrom)
			v_indexTo--; // we would have removed the old value by the time we reach the new position, changing the index by one
		else
			v_indexFrom++; // we would have inserted the new value by the time we reach the old position, changing the index by one
			
		for (var v_i=0; v_i<v_array.length; v_i++)
		{
			if (v_i!=v_indexFrom)
				v_a.push(v_array[v_i]);
			if (v_i==v_indexTo)
				v_a.push(v_val);
		}
		return v_a;
	};
	
	M.log = function(v_level, v_msg)
	{
		v_pub.i.log(v_level, v_msg, "table"); 
	};
	
	
	/*********************************************
	* Table object
	*********************************************/
	M.createColumn = function(v_t, v_i, v_n)
	{
		var v_col = new Object();
		v_col.m_type = v_t;
		v_col.m_index = v_i;
		v_col.m_name = v_n;
		return v_col;
	};
	
	M.createCell = function()
	{
		var v_cell = new Object();
		v_cell.m_value = v_undefined;
		v_cell.m_data = v_undefined;
		return v_cell;
	};
	
	M.createRow = function(v_i, v_n)
	{
		var v_row = new Object();
		v_row.m_cells = new Array();
		v_row.m_index = v_i;
		v_row.m_name = v_n;
		return v_row;
	};
	
	/*
	*
	*/
	M.initTable = function()
	{
		this.m_requestParams = v_undefined;
		this.m_columns = new Array(); 
		this.m_rows = new Array();
		
		this.subscribe = M.subscribeTable;
		this.unsubscribe = function() { v_pub.i.closeRequest(this); };
		this.P_decode = M.decodeTable; // obfuscate the decoder
		this.getRowCount = M.getRowCount;
		this.getColumnCount = M.getColumnCount;
		this.getRowName = M.getRowName;
		this.getColumnName = M.getColumnName;
		this.getColumnType = M.getColumnType;
		this.getCellValue = M.getCellValue;
		this.getUserData = M.getUserData;
		
		return this; 
	};
	
	/*
	 * Get the number of rows in the table
	 */
	M.getRowCount = function()
	{
		return this.m_rows.length;
	};

	/*
	 * Get the number of columns in the table
	 */
	M.getColumnCount = function()
	{
		return this.m_columns.length;
	};

	/*
	 * Get a row name
	 */
	M.getRowName = function(v_index)
	{
		return this.m_rows[v_index].m_name;
	};

	/*
	 * Get a column name
	 */
	M.getColumnName = function(v_index)
	{
		return this.m_columns[v_index].m_name;
	};

	/*
	 * Get a column type
	 */
	M.getColumnType = function(v_index)
	{
		return this.m_columns[v_index].m_type;
	};

	/*
	 * Get a cell value
	 */
	M.getCellValue = function(v_rowIndex, v_colIndex)
	{
		var v_cell = this.m_rows[v_rowIndex].m_cells[v_colIndex];
		return v_cell.m_value;
	};

	/*
	 * Get cell user data
	 */
	M.getUserData = function(v_rowIndex, v_colIndex)
	{
		var v_cell = this.m_rows[v_rowIndex].cells[v_colIndex];
		return v_cell.m_data;
	};
	
	
	/*
	* starts a Table request
	*/	
	M.subscribeTable = function(v_params) 
	{ 
		if (!v_params) // allow params to be specified at time of calling the request
			throw "No request params specified";
			
		if (!v_params.source) v_params.source = v_pub.i.callback.source || "";
		if (!v_params.symbol) v_params.symbol = "";
		if (!v_params.filter) v_params.filter = "";

		// If conflation is undefined, first try the conflation value from data.init.
		// If that is also undefined, used the default C_DefaultConflation.
		if (v_params.conflation == v_undefined) 
			v_params.conflation = v_pub.i.callback.conflation;
		if(v_params.conflation == v_undefined)
			v_params.conflation = v_pub.i.getDefaultConflation();

		if (v_params.source == "") throw "No source defined";
		if (v_params.symbol == "") throw "No symbol defined";
		
		var v_header = [v_pub.i.DatKey.Source, v_params.source, 
						v_pub.i.DatKey.Item, v_params.symbol, 
						v_pub.i.DatKey.Conflation, v_params.conflation];
		if (v_params.filter && v_params.filter.length>0)
			v_header.push(v_pub.i.DatKey.Filter, v_params.filter);		
		v_pub.i.openRequest(this, v_header, "Table", v_params); 
	};
	
	
	/*
	 * Add a new column
	 */
	M.addColumn = function(v_name)
	{
		// Add the column
		var v_col = M.createColumn(v_pub.DatType.None, this.m_columns.length, v_name);
		this.m_columns.push(v_col);

		// Add a new cell to all the rows
		for(var v_i = 0; v_i < this.m_rows.length; v_i++)
		{
			this.m_rows[v_i].m_cells.push(M.createCell());
		}

		// Notify listeners
		if (this.m_requestParams.onColumnAdded) 
			this.m_requestParams.onColumnAdded(this);

		// Return it
		M.log(LogLevel.TRACE, "addColumn(" + v_name + ") =" + v_col.m_index);
		return v_col;
	};
	
	/*
	 * Set column name
	 */
	M.setColumnName = function(v_col, v_name)
	{
		if(!v_col)
			return;
		v_col.m_name = v_name;

		// Notify listeners
		if (this.m_requestParams.onColumnNameChanged) 
			this.m_requestParams.onColumnNameChanged(this, v_col.m_index, v_name);
	};

	/*
	 * Set column type
	 */
	M.setColumnType = function(v_col, v_type)
	{
		if(!v_col)
			return;
		v_col.m_type = parseInt(v_type);
		
		// Notify listeners
		if (this.m_requestParams.onColumnTypeChanged) 
			this.m_requestParams.onColumnTypeChanged(this, v_col.m_index, v_type);
	};
	
	/*
	 * Select column by index
	 */
	M.selectColumn = function(v_index)
	{
		v_index = parseInt(v_index);
		
		// Add blank columns until the index is in range
		while(v_index >= this.m_columns.length)
			M.addColumn(this, "");
		var v_col = this.m_columns[v_index];
		M.log(LogLevel.TRACE, "selectColumn(" + v_index + ") " + v_col.m_name);
		return v_col;
	};
	
	/*
	 * Find a column by name
	 */
	M.findColumn = function(v_name)
	{
		for(var v_i = 0; i < this.m_columns.length; v_i++)
		{
			if(this.m_columns[i].m_name==v_name)
				return this.m_columns[i];
		}
		return null;
	};
	
	/*
	 * Delete common helper
	 * Assumes index has already been validated
	 */
	M.deleteColumn = function(v_index)
	{
		v_index = parseInt(v_index);
		
		// Notify listeners
		if (this.m_requestParams.onColumnRemoved) 
			this.m_requestParams.onColumnRemoved(this, v_col.m_index);
			
		// Remove the column
		this.m_columns = M.arrayRemoveAt(this.m_columns, v_index);

		// Remove cells
		for(var v_i=0; v_i < this.m_rows.length; v_i++)
		{
			var v_r = this.m_rows[i].m_cells;
			v_r.m_cells = M.arrayRemoveAt(v_r.m_cells, v_index);
		}

		// Update column indices
		for(var v_i = v_index; v_i < this.m_columns.length; v_i++)
		{
			this.m_columns[v_i].m_index = v_i;
		}
	};
	
	/*
	 * Delete all columns
	 */
	M.deleteAllColumns = function()
	{
		// Notify listeners
		if (this.m_requestParams.onAllColumnsRemoved) 
			this.m_requestParams.onAllColumnsRemoved(this);

		// Remove all columns
		this.m_columns = new Array();

		// Remove all cells
		for(var v_i = 0; v_i < this.m_rows.length; v_i++)
			this.m_rows[v_i].m_cells = new Array();
	};

	/*
	 * Move a column
	 */
	M.moveColumn = function(v_col, v_newIndex)
	{
		var v_i1, v_i2;

		// Validate params

		if(!v_col)
			return;
		v_i1 = v_col.m_index;
		v_i2 = parseInt(v_newIndex);
		if(v_i2 < 0 || v_i2 >= this.m_columns.length || v_i2 == v_i1)
			return;

		// Move the column and all cells
		
		this.m_columns = M.arrayMove(this.m_columns, v_i1, v_i2);
		
		for(var v_i=0; v_i < this.m_rows.length; v_i++)
		{
			var v_r = this.m_rows[v_i];
			v_r.m_cells = M.arrayMove(v_r.m_cells, v_i1, v_i2);
		}

		// Update column indices

		for(var v_i = 0; v_i < this.m_columns.length; v_i++)
		{
			this.m_columns[v_i].m_index = v_i;
		}
	
		// Notify listeners
		if (this.m_requestParams.onColumnMoved) 
			this.m_requestParams.onColumnMoved(this, v_i1, v_i2);
	};

	/*
	 * Add a new row
	 */
	M.addRow = function(v_name)
	{
		// Add the column

		var v_row = M.createRow(this.m_rows.length, v_name);
		this.m_rows.push(v_row);

		// Add a cell for each column
		for(var v_i = 0; v_i < this.m_columns.length; v_i++)
		{
			v_row.m_cells.push(M.createCell());
		}
		
		// Notify listeners
		if (this.m_requestParams.onRowAdded) 
			this.m_requestParams.onRowAdded(this);

		// Return it
		M.log(LogLevel.TRACE, "addRow(" + v_name + ") =" + v_row.m_index);
		return v_row;
	};

	/*
	 * Set row name
	 */
	M.setRowName = function(v_row, v_name)
	{
		if(!v_row)
			return;

		// Update the row name

		v_row.m_name = v_name;

		// Notify listeners
		if (this.m_requestParams.onRowNameChanged) 
			this.m_requestParams.onRowNameChanged(this, v_row.m_index, v_name);
	};

	/*
	 * Select row by index
	 */
	M.selectRow = function(v_index)
	{
		v_index = parseInt(v_index);

		// Add blank rows until the index is in range
		
		while(v_index>= this.m_rows.length)
			M.addRow.call(this, "");

		var v_row = this.m_rows[v_index];
		M.log(LogLevel.TRACE, "selectRow(" + v_index + ") " + v_row.m_name + " " + v_row.m_cells.length);
		return v_row;
	};

	/*
	 * Delete common helper
	 * Assumes index has already been validated
	 */
	M.deleteRow = function(v_index)
	{
		v_index = parseInt(v_index);
		
		var v_row = this.m_rows[v_index];

		// Remove the row

		this.m_rows = M.arrayRemoveAt(this.m_rows, v_index);

		// Update row indices

		for(var v_i = v_index; v_i < this.m_rows.length; v_i++)
			this.m_rows[v_i].m_index = v_i;

		// Notify listeners
		if (this.m_requestParams.onRowRemoved) 
			this.m_requestParams.onRowRemoved(this, v_row.m_index);
	};

	/*
	 * Delete all rows
	 */
	M.deleteAllRows = function()
	{
		// Notify listeners
		if (this.m_requestParams.onAllRowsRemoved) 
			this.m_requestParams.onAllRowsRemoved(this);

		this.m_rows = new Array();
	};

	/*
	 * Move a row
	 */
	M.moveRow = function(v_row, v_newIndex)
	{
		var v_i1, v_i2;

		// Validate params
	
		if(!v_row)
			return;
		v_i1 = v_row.m_index;
		v_i2 = parseInt(v_newIndex);
		if(v_i2 < 0 || v_i2 >= this.m_rows.length || v_i2 == v_i1)
			return;

		// Move the row
		this.m_rows = M.arrayMove(this.m_rows, v_i1, v_i2);
		
		// Update row indices
		for (var v_i = 0; v_i < this.m_rows.length; v_i++)
		{
			this.m_rows[v_i].m_index = v_i;
		}

		// Notify listeners
		if (this.m_requestParams.onRowsMoved) 
			this.m_requestParams.onRowsMoved(this, v_i1, v_i2);
	};

	/*
	 * Set user data
	 */
	M.setUserData = function(v_row, v_col, v_value)
	{
		if(!v_row || !v_col)
			return;

		v_row.m_cells[v_col.m_index].m_data = v_value;

		// Notify listeners
		if (this.m_requestParams.onCellDataChanged) 
			this.m_requestParams.onCellDataChanged(this, v_row.m_index, v_col.m_index, v_value);
	};

	/*
	 * Update a cell
	 */
	M.setCell = function(v_row, v_col, v_value)
	{
		if(!v_row || !v_col)
			return;

		v_row.m_cells[v_col.m_index].m_value = v_value;

		// Notify listeners
		if (this.m_requestParams.onCellChanged) 
			this.m_requestParams.onCellChanged(this, v_row.m_index, v_col.m_index, v_value);
	};
	
	
	/*
	* Table message cracker
	*/	
	M.decodeTable = function(v_bImage, v_header, v_body)
	{
		if (this.m_requestParams.onBeginUpdate) 
			this.m_requestParams.onBeginUpdate(this, v_bImage);
		
		var v_col, v_row;

		for (var v_i=0; v_i<v_body.length; v_i+=2)
		{
			var v_key    = v_body[v_i];
			var v_value = v_body[v_i+1];
			
			if(v_key >= C_DatTableOp.SetCell)
			{
				v_col = M.selectColumn.call(this, v_key - C_DatTableOp.SetCell);
				M.setCell.call(this, v_row, v_col, v_value);
				continue;
			}
			
			
			switch(v_key)
			{
				case C_DatTableOp.AddColumn:
					v_col = M.addColumn.call(this, v_value);
					break;

				case C_DatTableOp.SetColumnName:
					M.setColumnName.call(this, v_col, v_value);
					break;

				case C_DatTableOp.SetColumnType:
					M.setColumnType.call(this, v_col, v_value);
					break;

				case C_DatTableOp.SelectColumn:
					v_col = M.selectColumn.call(this, v_value);
					break;

				case C_DatTableOp.DeleteColumn:
					M.deleteColumn.call(this, v_value);
					v_col = v_undefined;
					break;

				case C_DatTableOp.DeleteAllColumns:
					v_deleteAllColumns.call(this);
					v_col = v_undefined;
					break;

				case C_DatTableOp.MoveColumn:
					M.moveColumn.call(this, v_col, v_value);
					break;

				case C_DatTableOp.AddRow:
					v_row = M.addRow.call(this, v_value);
					break;

				case C_DatTableOp.SetRowName:
					M.setRowName.call(this, v_row, v_value);
					break;

				case C_DatTableOp.SelectRow:
					v_row = M.selectRow.call(this, v_value);
					break;

				case C_DatTableOp.DeleteRow:
					M.deleteRow.call(this, v_value);
					v_row = v_undefined;
					break;

				case C_DatTableOp.DeleteAllRows:
					M.deleteAllRows.call(this);
					v_row = v_undefined;
					break;

				case C_DatTableOp.MoveRow:
					M.moveRow.call(this, v_row, v_value);
					break;

				case C_DatTableOp.SetUserData:
					M.setUserData.call(this, v_row, v_col, v_value);
					break;
			}
		}
		if (this.m_requestParams.onEndUpdate) 
			this.m_requestParams.onEndUpdate(this, v_bImage);
	};
	
	/*
	* public datatype definitions
	*/
	v_pub.table = M.initTable;
    v_pub.table.prototype.toString = function() 
    { 
		return this.m_requestParams.source + " " + this.m_requestParams.symbol + " " + this.m_requestParams.filter + " rows:" + this.m_rows.length + " cols:" + this.m_columns.length;
	};
	
	
	
})();


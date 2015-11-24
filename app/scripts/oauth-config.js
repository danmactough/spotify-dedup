/*exported OAuthConfig*/

var OAuthConfig = (function() {
  'use strict';

  var clientId = 'fb182abd36104636b1e0b733e1e9cd3c';
  var redirectUri;
  if (location.host === 'localhost:8005') {
    redirectUri = 'http://localhost:8005/callback.html';
  } else {
    redirectUri = 'https://mact.me/spotify-album-merge/callback.html';
  }
  var host = /http[s]?:\/\/[^/]+/.exec(redirectUri)[0];
  return {
    clientId: clientId,
    redirectUri: redirectUri,
    host: host
  };
})();

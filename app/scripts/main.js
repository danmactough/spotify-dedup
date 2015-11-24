/*global ko, PromiseThrottle, SpotifyWebApi, OAuthManager, Promise */

(function() {
  'use strict';

  var token,
      api;

  function ArtistModel (artist) {
    var self = this;
    this.artist = artist;
    this.id = artist.id;
    this.name = artist.name;
    this.albums = ko.observableArray([]);
    this.status = ko.observable('');
    this.processed = ko.observable(false);
    this.removeDuplicates = function () {
      return false;
    };
    this.removeAlbum = function (Album) {
      var trackIds = Album.tracks();
      api.removeFromMySavedTracks(trackIds)
        .then(function () {
          self.albums.remove(Album);
        })
        .catch(function (e) {
          console.error(e);
          alert('Error removing tracks from ' + Album.name);
        });
    };
    this.saveAlbum = function (Album) {
      var albumIds = [Album.id];
      api.addToMySavedAlbums(albumIds)
        .then(function () {
          self.albums.remove(Album);
        })
        .catch(function (e) {
          console.error(e);
          alert('Error removing tracks from ' + Album.name);
        });
    };
  }

  function AlbumModel (album) {
    var self = this;
    this.album = album;
    this.id = album.id;
    this.name = album.name;
    this.images = album.images;
    this.available_markets = album.available_markets;
    this.nameNormalized = ko.computed(function () {
      return self.name.toLowerCase().replace(/\B(?:&|\+)\B/g, "and").replace(/[-\(]+?.*?(?:edition|mastered|version)[\W-]*$/i, '').trim();
    });
    this.tracks = ko.observableArray([]);
    this.status = ko.observable('');
    this.processed = ko.observable(false);
    this.isCanonical = ko.observable(false);
    this.isAvailable = ko.computed(function () {
      return ~self.available_markets.indexOf("US");
    });
    this.onMouseover = function () {
      var img = self.images[1];
      model.selectedUrl(img.url);
    };
    this.onMouseout = function () {
      model.selectedUrl("");
    };
  }

  function TrackModel (track) {
    this.track = track;
    this.status = ko.observable('');
  }

  function ArtistAlbumDedupModel () {
    this.isLoggedIn = ko.observable(false);
    this.artists = ko.observableArray([]);
    this.albums = ko.observableArray([]);
    this.tracks = ko.observableArray([]);
    this.albumsToSave = ko.observableArray([]);
    this.albumsToRemove = ko.observableArray([]);
    this.toProcess = ko.observable(1);
    this.startedProcessing = ko.observable(false);
    this.selectedUrl = ko.observable("");
  }

  var promiseThrottle = new PromiseThrottle({requestsPerSecond: 10});
  var model = window.model = new ArtistAlbumDedupModel();

  ko.applyBindings(model);

  document.getElementById('login').addEventListener('click', function() {
    OAuthManager.obtainToken({
      scopes: [
          'user-library-read',
          'user-library-modify'
        ]
      }).then(function(token) {
        onTokenReceived(token);
      }).catch(function(error) {
        console.error(error);
      });
  });

  function fetchUserTracks() {
    return promisesForPages(promiseThrottle.add(function() {
        // fetch user's saved tracks, 50 at a time
          return api.getMySavedTracks({limit: 50});
        }))
        .then(function(pagePromises) {
          // wait for all promises to be finished
          return Promise.all(pagePromises);
        }).then(function(pages) {
          // combine and filter artist/albums
          var items = pages.reduce(function (map, page) {
            map = map.concat(page.items);
            return map;
          }, []);

          return items;
        });
  }

  function processFetchedTracks(items) {
    var userMusic = items.reduce(function (map, item) {
      var track = item.track;
      var album = item.track.album;
      var artists = item.track.artists;

      var Track = new TrackModel(track);
      map.tracks[track.id] = Track;

      var Album = map.albums[album.id];
      if (!Album) {
        Album = new AlbumModel(album);
        map.albums[album.id] = Album;
      }
      Album.tracks.push(track.id);

      artists.forEach(function (artist) {
        var Artist = map.artists[artist.id];
        if (!Artist) {
          Artist = new ArtistModel(artist);
          map.artists[artist.id] = Artist;
          model.artists.push(Artist);
        }
        if (Artist.albums.indexOf(Album) === -1) {
          Artist.albums.push(Album);
        }
      });
      return map;
    }, {
      artists: {},
      albums: {},
      tracks: {}
    });

    model.toProcess(model.artists().length);

    return Promise.resolve(userMusic);
  }

  function fetchArtistAlbums(Artist) {
    return promisesForPages(promiseThrottle.add(function() {
        // fetch artists's albums, 50 at a time
          return api.getArtistAlbums(Artist.id, {limit: 50, album_type: 'album', market: 'US'});
        }))
        .then(function(pagePromises) {
          // wait for all promises to be finished
          return Promise.all(pagePromises);
        }).then(function(pages) {
          var items = pages.reduce(function (map, page) {
            map = map.concat(page.items);
            return map;
          }, []);

          return items;
        });
  }

  function processArtistAlbums(Artist, albums) {
    var foundCanonical = false;
    albums.forEach(function (album) {
      Artist.albums().forEach(function (Album) {
        if (album.id === Album.id) {
          Album.isCanonical(true);
          foundCanonical = true;
        }
      });
      if (!foundCanonical) {
        var Album = new AlbumModel(album);
        Album.isCanonical(true);
        Artist.albums.push(Album);
      }
    });
    model.toProcess(model.toProcess() - 1);
    return Promise.resolve();
  }

  // function onPlaylistProcessed(playlist) {
  //   playlist.processed(true);
  //   model.toProcess(model.toProcess() - 1);
  // }

  function onUserDataFetched(data) {
    var user = data.id;

    fetchUserTracks(user)
      .then(processFetchedTracks)
      .then(function () {
        model.startedProcessing(true);
        return model.artists().map(function (Artist) {
          return fetchArtistAlbums(Artist).then(function (albums) {
            return processArtistAlbums(Artist, albums);
          });
        });
      });
  }

  function onTokenReceived(accessToken) {
    model.isLoggedIn(true);
    token = accessToken;

    api = new SpotifyWebApi();
    api.setAccessToken(token);

    promiseThrottle.add(function() {
      return api.getMe().then(onUserDataFetched);
    });
  }


  function promisesForPages(promise) {

    var retriesByOffset = {};

    function stripParameters(href) {
      var u = new URL(href);
      return u.origin + u.pathname;
    }

    function fetchGeneric(results, offset, limit) {
      return api.getGeneric(stripParameters(results.href) +
        '?offset=' + offset +
        '&limit=' + limit).catch(function (e) {
          if (!retriesByOffset[offset]) {
            retriesByOffset[offset] = 0;
          }
          if (++retriesByOffset[offset] < 5) {
            return fetchGeneric(results, offset, limit);
          }
          else {
            throw e;
          }
        });
    }

    return new Promise(function(resolve, reject) {
      promise.then(function(results) {
        var promises = [promise],                       // add the initial page
            offset = results.limit + results.offset,    // start from the second page
            limit = results.limit;
        while (results.total > offset) {
          var q = promiseThrottle.add(fetchGeneric.bind(this, results, offset, limit));
          promises.push(q);
          offset += limit;
        }
        resolve(promises);
      }).catch(function() {
        reject([]);
      });
    });
  }

})();

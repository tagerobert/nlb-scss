/* jshint esversion: 6 */

/*

File name: rb_smil_emulator.js
Version: 1.12
Date: 2014-05-20
Author: Alberto Pettarin (alberto AT albertopettarin DOT it)
Description: this JS provides Media Overlay (SMIL) support for EPUB 3 reflowable eBooks
Modified by : Ammar usama (2018) www.nlb.no, Gaute Rønningen (2019) www.nlb.no

License
=======

The MIT License (MIT)

Copyright (c) 2013 Alberto Pettarin (alberto AT albertopettarin DOT it)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


Usage
=====

In your XHTML page (say, page.xhtml) you must add:

1) HEAD:
<script type="text/javascript" src="path/to/rb_smil_emulator.js"></script>
<script type="text/javascript" src="path/to/page.smil.js"></script>

2) AS LAST ELEMENT OF BODY (see init() below for the description of the optional parameters):
<script type="text/javascript">
//<![CDATA[
  window.addEventListener('DOMContentLoaded', 
    function() {
      window.rb_smil_emulator.init('path/to/page.mp3', {k1: p1, k2: p2, k3: p3});
    }
  );
//]]>
</script>

Remember to:
1) define two CSS classes to style the active or paused SMIL fragment
(the default names are 'rbActiveFragment' and 'rbPausedFragment', respectively), and
2) generate page.smil.js, containing smil_data and smil_ids.

The SMIL fragments, defined in page.smil.js,
must be contiguous
(the end of the i-th fragment coincides with
the begin of the (i+1)-th fragment),
and span the entire audio track
(the first fragment should start at time zero,
while the last fragment should end
at the end of the audio track).
Fragments might have zero duration
(i.e., their begin and end time coincide).

Please observe that smil_data.length
should be equal to smil_ids.length,
and it should be equal to the number of SMIL fragments;
the fragments must appear in these two arrays
sorted according to their begin time.
Fragment IDs might be arbitrary (but unique) strings.

*/

(function() {
  var doc = document;
  var smil_data = [];

  window.rb_smil_emulator = {
    // BEGIN parameters
    active_fragment_class_name: "rbActiveFragment",
    paused_fragment_class_name: "rbPausedFragment",
    autostart_audio: false,
    autostart_wait_event: "canplay",
    autoturn_page: true,
    single_fragment: false,
    outside_taps_clear: false,
    outside_taps_can_resume: true,
    outside_taps_threshold: 1,
    associated_events: ["click", "touchend"],
    ignore_taps_on_a_elements: true,
    allowed_reading_systems: ["ALL"],
    hide_elements: [],
    // END parameters

    // BEGIN fields
    rb_audio_id: "rbAudioElement",
    rb_audio_class_name: "rbAudioElement",
    state_started: false,
    state_playing: false,
    state_completed: false,
    current_number_outside_taps: 0,
    current_idx: -1,
    audio_paused_at: -1,
    smil_data: smil_data,
    audio: null,
    timer: null,
    previous_fragment_offsetTop: -1,
    current_reading_system: "",
    // END fields

    /*
    audio_file: path to audio file
        
    parameters: dictionary (possibly empty) containing parameters to tweak SMIL rendition.
        Accepted keys are:
        * active_fragment_class_name
            Type: string
            Default value: rbActiveFragment
            Description: CSS class to be applied to active SMIL fragment
        * paused_fragment_class_name
            Type: string
            Default value: rbPausedFragment
            Description: CSS class to be applied to paused SMIL fragment
        * autostart_audio
            Type: boolean
            Default value: false
            Description: set to true to have the audio autostart as soon as the audio file has been loaded, false otherwise
        * autostart_wait_event
            Type: string
            Default value: canplay
            Description: name of the event to wait for before autostarting the audio (e.g.: canplay, canplaythrough)
        * autoturn_page
            Type: boolean
            Default value: false
            Description: set to true if you want this JS to reset location.href to the active element id only when page changes, false otherwise
            WARNING: this feature is experimental, and it is enabled on iBooks only: on other Reading Systems it has no effect 
        * single_fragment
            Type: boolean
            Default value: false
            Description: set to true if you want to play just one fragment at a time (user must keep tapping on fragments), false otherwise
        * outside_taps_clear
            Type: boolean
            Default value: false
            Description: set to true if you want tap(s) outside SMIL fragments to clear last played SMIL fragment status, false otherwise
        * outside_taps_can_resume
            Type: boolean
            Default value: false
            Description: set to true if you want tap(s) outside SMIL fragments to resume SMIL rendition, false otherwise
        * outside_taps_threshold
            Type: integer
            Default value: 1
            Description: number of taps outside SMIL fragments required to stop/pause; set to 0 to disable
        * associated_events
            Type: array of strings
            Default value: ['click', 'touchend']
            Description: start/pause/stop SMIL rendition on the occurrence of the events whose names are listed here
        * ignore_taps_on_a_elements
            Type: boolean
            Default value: true
            Description: set to true if you want tap(s) on <a> elements to be ignored, false otherwise
        * allowed_reading_systems
            Type: array of strings
            Default value: ['ALL']
            Description: execute SMIL emulation only if navigator.epubReadingSystem.name (lower-cased) is listed here (e.g., 'ibooks', 'readium');
                         set to 'ALL' to allow any reading system (even if it does not expose navigator.epubReadingSystem)
            WARNING: this JS is never executed when run in Readium, even when 'ALL' is specified (see line 257)
        * hide_elements 
            Type: array of strings
            Default value: []
            Description: set display:none for the DOM elements listed, useful for hiding e.g. an <audio> element on page
            WARNING: this feature is enabled on iBooks only: on other Reading Systems it has no effect
    */
    init: function(audio_file, parameters) {
      var rb_smil_emulator = window.rb_smil_emulator;

      // store parameters
      if ("active_fragment_class_name" in parameters) {
        rb_smil_emulator.active_fragment_class_name =
          parameters.active_fragment_class_name;
      }
      if ("paused_fragment_class_name" in parameters) {
        rb_smil_emulator.paused_fragment_class_name =
          parameters.paused_fragment_class_name;
      }
      if ("autostart_audio" in parameters) {
        rb_smil_emulator.autostart_audio = parameters.autostart_audio;
      }
      if ("autostart_wait_event" in parameters) {
        rb_smil_emulator.autostart_wait_event = parameters.autostart_wait_event;
      }
      if ("single_fragment" in parameters) {
        rb_smil_emulator.single_fragment = parameters.single_fragment;
      }
      if ("outside_taps_clear" in parameters) {
        rb_smil_emulator.outside_taps_clear = parameters.outside_taps_clear;
      }
      if ("outside_taps_can_resume" in parameters) {
        rb_smil_emulator.outside_taps_can_resume =
          parameters.outside_taps_can_resume;
      }
      if ("outside_taps_threshold" in parameters) {
        rb_smil_emulator.outside_taps_threshold =
          parameters.outside_taps_threshold;
      }
      if ("autoturn_page" in parameters) {
        rb_smil_emulator.autoturn_page = parameters.autoturn_page;
      }
      if ("associated_events" in parameters) {
        rb_smil_emulator.associated_events = parameters.associated_events;
      }
      if ("ignore_taps_on_a_elements" in parameters) {
        rb_smil_emulator.ignore_taps_on_a_elements =
          parameters.ignore_taps_on_a_elements;
      }
      if ("allowed_reading_systems" in parameters) {
        rb_smil_emulator.allowed_reading_systems =
          parameters.allowed_reading_systems;
      }
      if ("hide_elements" in parameters) {
        rb_smil_emulator.hide_elements = parameters.hide_elements;
      }

      // try determining the current reading system
      if (
        navigator &&
        navigator.epubReadingSystem &&
        navigator.epubReadingSystem.name
      ) {
        rb_smil_emulator.current_reading_system = navigator.epubReadingSystem.name.toLowerCase();
      } else {
        // detect new Readium
        // code courtesy of Daniel Weck
        // see https://github.com/pettarin/rb_smil_emulator/issues/2
        try {
          if (
            window.LauncherUI ||
            (window.parent &&
              window.parent !== window &&
              window.parent.ReadiumSDK)
          ) {
            rb_smil_emulator.current_reading_system = "readium";
          }
        } catch (e) {
          // something went wrong
          // cross origin iframe parent access?
          // console.error(e);
        }

        // detect iBooks for Mac OS X
        try {
          // code courtesy of Daniel Weck
          // see https://twitter.com/DanielWeck/status/412669371161784321
          // see https://twitter.com/acutebit/status/412679039153762304
          if (
            window.iBooks ||
            (window.location.href &&
              window.location.href
                .toLowerCase()
                .indexOf("com.apple.bkagentservice") >= 0)
          ) {
            rb_smil_emulator.current_reading_system = "ibooks";
          }
        } catch (e) {
          // something went wrong
          // console.error(e);
        }
      }

      // never execute when run in Readium
      if (rb_smil_emulator.current_reading_system == "readium") {
        return false;
      }

      // check whether the current reading system is allowed: if not, abort
      var abort = true;
      for (
        var i = 0;
        i < rb_smil_emulator.allowed_reading_systems.length;
        ++i
      ) {
        var ars = rb_smil_emulator.allowed_reading_systems[i];
        if (ars == "ALL" || ars == rb_smil_emulator.current_reading_system) {
          abort = false;
          break;
        }
      }
      if (abort) {
        return false;
      }

      // create <audio> element
      var audio = document.createElement("audio");
      audio.id = rb_smil_emulator.rb_audio_id;
      audio.src = audio_file;
      audio.classList.add(rb_smil_emulator.rb_audio_class_name);
      doc.body.appendChild(audio);
      rb_smil_emulator.audio = audio;

      // trick to force loading the audio file
      audio.play();
      audio.pause();

      // add listener to catch touch events
      for (var j = 0; j < rb_smil_emulator.associated_events.length; ++j) {
        doc.addEventListener(
          rb_smil_emulator.associated_events[j],
          rb_smil_emulator.on_touch_event
        );
      }

      // hide elements
      if (rb_smil_emulator.current_reading_system == "ibooks") {
        for (var k = 0; k < rb_smil_emulator.hide_elements.length; ++k) {
          var el = doc.getElementById(rb_smil_emulator.hide_elements[k]);
          if (el) {
            el.style.display = "none";
          }
        }
      }

      // if autostart_audio, start audio at first fragment
      // as soon as autostart_wait_event occurs
      if (rb_smil_emulator.autostart_audio) {
        audio.addEventListener(
          rb_smil_emulator.autostart_wait_event,
          function() {
            rb_smil_emulator.play(0, true, -1);
          },
          false
        );
      }
    },

    // process touch event
    on_touch_event: function(element) {
      var rb_smil_emulator = window.rb_smil_emulator;
      var current_idx = rb_smil_emulator.current_idx;
      var touched_idx = rb_smil_emulator.check_id(element.target);
      if (touched_idx > -1) {
        // the touched element is a SMIL fragment
        rb_smil_emulator.current_number_outside_taps = 0;
        if (touched_idx == current_idx) {
          if (rb_smil_emulator.audio.paused) {
            // resume
            rb_smil_emulator.play(
              current_idx,
              true,
              rb_smil_emulator.audio_paused_at
            );
          } else {
            // pause
            rb_smil_emulator.pause();
          }
        } else {
          // play touched one
          rb_smil_emulator.play(touched_idx, true, -1);
        }
      } else {
        // the touched element is not a SMIL fragment
        if (rb_smil_emulator.outside_taps_threshold > 0) {
          rb_smil_emulator.current_number_outside_taps += 1;
          if (
            rb_smil_emulator.current_number_outside_taps >=
            rb_smil_emulator.outside_taps_threshold
          ) {
            // resume or pause/stop

            var type = element.target.nodeName;
            var type_id = element.target.id;

            if (
              (type.toLowerCase() == "button" &&
                type_id.toLowerCase() == "play_button") ||
              type.toLowerCase() == "a"
            ) {
              if (
                rb_smil_emulator.audio.paused &&
                type.toLowerCase() == "button"
              ) {
                if (current_idx == -1) {
                  //************adding last location***********************
                  // **Check browser support
                  var book_storage_value = document.getElementById("mybook_id")
                    .innerHTML;
                  var page_id_storage_idx = 0;
                  if (typeof Storage !== "undefined") {
                    try {
                      var myid_storage_retrived = localStorage.getItem(
                        book_storage_value
                      );
                      var objplay = JSON.parse(myid_storage_retrived);

                      var my_paused_id = objplay.myid;
                      var my_paused_time = objplay.mylocation;
                      window.location = "#" + my_paused_id;
                      page_id_storage_idx = rb_smil_emulator.smil_ids.indexOf(
                        my_paused_id
                      );
                      if (page_id_storage_idx < 0) {
                        page_id_storage_idx = 0;
                      }
                      rb_smil_emulator.play(
                        page_id_storage_idx,
                        true,
                        my_paused_time
                      );
                    } catch (e) {
                      rb_smil_emulator.play(page_id_storage_idx, true, -1);
                    }
                  }
                } else {
                  rb_smil_emulator.play(
                    current_idx,
                    true,
                    rb_smil_emulator.audio_paused_at
                  );
                }
              } else if (type.toLowerCase() == "button") {
                rb_smil_emulator.pause();
              }
              //*****************this is treating  link tag of toc************ */
              if (type.toLowerCase() == "a") {
                var type_href = element.target.href;
                var page_id_clicked = type_href.substring(
                  type_href.indexOf("#") + 1
                );
                var page_id_click_idx = rb_smil_emulator.smil_ids.indexOf(
                  page_id_clicked
                );
                rb_smil_emulator.pause();
                rb_smil_emulator.play(page_id_click_idx, true, -1);
              }
            } else {
              // pause
              rb_smil_emulator.pause();
            }

            // reset counter
            rb_smil_emulator.current_number_outside_taps = 0;
          }
        }
      }
    },

    // move to next fragment, if any
    on_next_event: function() {
      var rb_smil_emulator = window.rb_smil_emulator;
      var idx = rb_smil_emulator.current_idx;

      rb_smil_emulator.timer = null;
      rb_smil_emulator.stop();

      if (rb_smil_emulator.single_fragment) {
        rb_smil_emulator.audio.pause();
      } else {
        // any fragments left?
        if (idx + 1 < rb_smil_emulator.smil_data.length) {
          // yes, go to next fragment
          //************here is audio check code added 03.08***********
          var smil_data = window.rb_smil_emulator.smil_data;
          var audiosrc = smil_data[idx].file;
          var audiosrcnext = smil_data[idx + 1].file;
          var textids = smil_data[idx + 1].id;
          var myAudio_paused_at = smil_data[idx + 1].begin;

          //****************adding bookmarks for last read position *************
          if (typeof Storage !== "undefined") {
            var book_value_id = document.getElementById("mybook_id").innerHTML;
            //remove
            window.localStorage.removeItem(book_value_id);

            // Store
            const person = { myid: textids, mylocation: myAudio_paused_at };

            window.localStorage.setItem(book_value_id, JSON.stringify(person));
          }
          //****************adding bookmarks for last read position end *************

          //****************chacking audio file and change it if it is different *************
          if (audiosrc == audiosrcnext) {
            //rb_smil_emulator.play(idx + 1, true, -1);
            rb_smil_emulator.play(idx + 1, false, -1);
          } else {
            rb_smil_emulator.audio.src = audiosrcnext;
            rb_smil_emulator.play(idx + 1, true, -1);
          }
          //****************chacking audio file and change it if it is different End *************

          //************here is audio check code end***********
        } else {
          // no, end reached
          rb_smil_emulator.state_completed = true;
        }
      }
    },

    // pause audio and clear last SMIL fragment status
    stop: function() {
      var rb_smil_emulator = window.rb_smil_emulator;
      if (rb_smil_emulator.timer != null) {
        window.clearTimeout(rb_smil_emulator.timer);
      }
      rb_smil_emulator.timer = null;
      rb_smil_emulator.apply_stop_class();
      rb_smil_emulator.current_idx = -1;
      rb_smil_emulator.state_playing = false;
    },

    // pause audio
    pause: function() {
      var rb_smil_emulator = window.rb_smil_emulator;
      var audio = rb_smil_emulator.audio;
      audio.pause();
      document.getElementById("play_button_text").innerText = "Start";
      document.getElementById("play_button").style.backgroundImage =
        "url('play.svg')";

      /*
	  var activeClassName = document.getElementById("book_header").className;
	  if (activeClassName === "theme__dark")
	  {
		  document.getElementById('play_button').style.backgroundImage="url('play_white.svg')";
	  }
	  else
	  {
		  document.getElementById('play_button').style.backgroundImage="url('play.svg')";
	  }
	  */

      window.clearTimeout(rb_smil_emulator.timer);
      rb_smil_emulator.timer = null;
      rb_smil_emulator.audio_paused_at = audio.currentTime;
      rb_smil_emulator.apply_paused_class();
      rb_smil_emulator.state_playing = false;

      //****************adding bookmarks for last read position with time at pausing*************
      try {
        var smil_data = window.rb_smil_emulator.smil_data;
        var idx = rb_smil_emulator.current_idx;
        var textids = smil_data[idx].id;
        var myAudio_paused_at = rb_smil_emulator.audio_paused_at;

        if (typeof Storage !== "undefined") {
          var book_value_id = document.getElementById("mybook_id").innerHTML;
          //remove
          window.localStorage.removeItem(book_value_id);
          // Store
          const person = { myid: textids, mylocation: myAudio_paused_at };

          window.localStorage.setItem(book_value_id, JSON.stringify(person));
        }
      } catch (e) {
        // something went wrong
        // console.error(e);
      }
      //****************adding bookmarks for last read position end *************
    },

    /*
        play audio
        idx: index of the SMIL fragment (NOT its id, but its index in the ids array)
        reset_begin: if true, reset begin of the audio to begin_at_time
        begin_at_time: if < 0, then play the fragment from SMIL begin, otherwise from begin_at_time second
    */
    play: function(idx, reset_begin, begin_at_time) {
      var rb_smil_emulator = window.rb_smil_emulator;

      rb_smil_emulator.stop();

      rb_smil_emulator.current_idx = idx;
      rb_smil_emulator.apply_active_class();

      //****************testing  page view start********** */
      //code
      // see https://stackoverflow.com/questions/123999/how-to-tell-if-a-dom-element-is-visible-in-the-current-viewport

      var current_elenent_in_view = rb_smil_emulator.smil_ids[idx];
      var elements = document.getElementById(current_elenent_in_view);

      if (
        elements.getBoundingClientRect().top <= window.innerHeight * 0.75 &&
        elements.getBoundingClientRect().top > 0
      ) {
      } else {
        location.href = "#" + rb_smil_emulator.smil_ids[idx];
      }
      //****************testing  page view end********** */

      var smil_data = rb_smil_emulator.smil_data;
      var begin = begin_at_time;
      if (begin < 0) {
        begin = smil_data[idx].begin;
      }
      var end = smil_data[idx].end;

      //*******************checking and updating audio file*****************
      var loadedFileInMemory = rb_smil_emulator.audio.src
        .split("\\")
        .pop()
        .split("/")
        .pop(); // checking file
      var currentfileName = rb_smil_emulator.smil_data[idx].file
        .split("\\")
        .pop()
        .split("/")
        .pop(); // checking file
      var audio = rb_smil_emulator.audio;

      if (currentfileName != loadedFileInMemory) {
        rb_smil_emulator.audio.src = rb_smil_emulator.smil_data[idx].file;
      }

      //******************audio speed start****************

      var playback = document.getElementById("pbr");
      var play_value = playback.value;
      var audio_current_placback = rb_smil_emulator.audio.playbackRate;

      if (audio_current_placback != play_value) {
        rb_smil_emulator.audio.playbackRate = play_value;
      }
      //******************audio speed end****************
      //*******************checking and updating audio file end*****************

      if (reset_begin) {
        //var audio = rb_smil_emulator.audio;
        audio.currentTime = begin;

        audio.play();
        document.getElementById("play_button_text").innerText = "Stopp";
        document.getElementById("play_button").style.backgroundImage =
          "url('pause.svg')";
      }

      rb_smil_emulator.state_started = true;
      rb_smil_emulator.state_playing = true;
      //rb_smil_emulator.timer = window.setTimeout(rb_smil_emulator.on_next_event, (end - begin) * 1000);

      rb_smil_emulator.timer = window.setTimeout(
        rb_smil_emulator.on_next_event,
        ((end - begin) / play_value) * 1000
      );
    },

    // apply active class to the current fragment
    apply_active_class: function() {
      var rb_smil_emulator = window.rb_smil_emulator;
      var idx = rb_smil_emulator.current_idx;
      if (idx >= 0) {
        var active_fragment = doc.getElementById(
          rb_smil_emulator.smil_ids[idx]
        );
        if (active_fragment) {
          active_fragment.classList.remove(
            rb_smil_emulator.paused_fragment_class_name
          );
          active_fragment.classList.add(
            rb_smil_emulator.active_fragment_class_name
          );
          //active_fragment.scrollIntoView();
          //active_fragment.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"});  //this is for moving to center of screen
        }
      }
    },

    // apply paused class to the current fragment
    apply_paused_class: function() {
      var rb_smil_emulator = window.rb_smil_emulator;
      var idx = rb_smil_emulator.current_idx;
      if (idx >= 0) {
        var active_fragment = doc.getElementById(
          rb_smil_emulator.smil_ids[idx]
        );
        if (active_fragment) {
          active_fragment.classList.remove(
            rb_smil_emulator.active_fragment_class_name
          );
          active_fragment.classList.add(
            rb_smil_emulator.paused_fragment_class_name
          );
        }
      }
    },

    // remove active/paused class from the current fragment, if any
    apply_stop_class: function() {
      var rb_smil_emulator = window.rb_smil_emulator;
      var idx = rb_smil_emulator.current_idx;
      if (idx >= 0) {
        var active_fragment = doc.getElementById(
          rb_smil_emulator.smil_ids[idx]
        );
        if (active_fragment) {
          active_fragment.classList.remove(
            rb_smil_emulator.paused_fragment_class_name
          );
          active_fragment.classList.remove(
            rb_smil_emulator.active_fragment_class_name
          );
        }
      }
    },

    /*
       check whether the touched element has a SMIL id,
       if not, check recursively the parent element;
       if the touched element is an <a>,
       and the user set ignore_taps_on_a_elements=True,
       then ignore the event
    */
    check_id: function(element) {
      var rb_smil_emulator = window.rb_smil_emulator;
      var type = element.nodeName;
      if (
        type.toLowerCase() == "a" &&
        rb_smil_emulator.ignore_taps_on_a_elements
      ) {
        return -1;
      }
      var id = element.id;
      while (rb_smil_emulator.smil_ids.indexOf(id) == -1) {
        element = element.parentNode;
        if (element == null) {
          return -1;
        }
        id = element.id;
      }
      return rb_smil_emulator.smil_ids.indexOf(id);
    }
  }; // END of rb_smil_emulator
})();

//************************extra javascript**********

//******load file***********
window.addEventListener("DOMContentLoaded", function() {
  window.rb_smil_emulator.init("", {
    autostart_audio: false,
    outside_taps_stop: false,
    outside_taps_can_resume: true
  });
});

//**********function for storing**************
window.onload = function() {
  //*******************changing play speed*************
  var p = document.getElementById("pbr");
  var c = document.getElementById("currentPbr");

  document.getElementById("expand_image").src = "expand.svg";
  document.getElementById("modus_knapp").src = "moon.svg";
  document.getElementById("hjelpknapp").src = "help.svg";
  document.getElementById("play_button").src = "play.svg";

  //c.innerHTML = 'Avspillingshastighet: '+p.value;

  //p.addEventListener('input',function(){
  //c.innerHTML = 'Avspillingshastighet: '+p.value;
  //v.playbackRate = p.value;
  //},false);

  //************adding last location***********************
  // **Check browser support
  var book_value = document.getElementById("mybook_id").innerHTML;
  if (typeof Storage !== "undefined") {
    try {
      var myid_storage_retrived = localStorage.getItem(book_value);
      var obj = JSON.parse(myid_storage_retrived);
      var my_paused_id = obj.myid;
      window.location = "#" + my_paused_id;
    } catch (e) {}
  }

  //********************** function for detect browser *************
  //  copied from  https://stackoverflow.com/questions/9847580/how-to-detect-safari-chrome-ie-firefox-and-opera-browser/9851769
  // Safari 3.0+ "[object HTMLElementConstructor]"
  var isSafari =
    /constructor/i.test(window.HTMLElement) ||
    (function(p) {
      return p.toString() === "[object SafariRemoteNotification]";
    })(!window.safari || safari.pushNotification);

  // Internet Explorer 6-11
  var isIE = /*@cc_on!@*/ false || !!document.documentMode;

  // Edge 20+
  var isEdge = !isIE && !!window.StyleMedia;

  if (isSafari === true || isIE === true || isIE === true) {
    var output =
      "Nettleserbok virker dessverre ikke optimalt i Internet Explorer eller Safari. Vennligst bruk en annen nettleser. For eksempel Chrome, Firefox eller Opera. Klikk hjelp-knapp for mer informasjon";

    document.getElementById("wrong_browser_text").innerHTML = output;
    document.getElementById("wrong_browser_text").style.display = "block";
  }
  //********************** function for detect browser end*************
};
//********************** function for percentage of book*************

const scroller = document.getElementById("content");
function scrolling() {
  let height = scroller.clientHeight;
  let scrollHeight = scroller.scrollHeight - height;
  let scrollTop = scroller.scrollTop;
  let percent = Math.floor((scrollTop / scrollHeight) * 40);
  document.getElementById("percent").innerText =
    "Framdrift: " + percent * 2.5 + "%";
  document.getElementById("myBar").style.width = percent + "%";
}

//********************** function for hide_extra book*************

function hide_extra() {
  var x = document.body;

  if (x.classList.contains("fullscreen")) {
    var j = document.getElementById("night_mode").innerHTML;
    if (j === "Nattmodus") {
      document.getElementById("expand_image").src = "expand.svg";
    } else {
      document.getElementById("expand_image").src = "expand_white.svg";
    }
    document.body.classList.remove("fullscreen");
  } else {
    document.getElementById("expand_image").src = "close.svg";
    document.body.classList.add("fullscreen");
  }
}

//********************** function for dark mode book*************

function dark() {
  var x = document.getElementById("night_mode").innerHTML;
  var toc_mode = document.getElementById("toc_container");

  if (x === "Nattmodus") {
    document.body.classList.add("theme__dark");
    document.getElementById("toc_container").classList.add("theme__dark");
    document.getElementById("content").classList.add("theme__dark");
    document.getElementById("page-list").classList.add("theme__dark");
    document.getElementById("book_header").classList.add("theme__dark");
    document.getElementById("night_mode").innerHTML = "Dagmodus";
    document.getElementById("logo").src = "logo_white.svg";
    document.getElementById("modus_knapp").style.backgroundImage = "url('sun.svg')";

    if (toc_mode.style.display === "none") {
    } else {
      document.getElementById("expand_image").src = "expand_white.svg";
    }
  } else {
    document.body.classList.remove("theme__dark");
    document.getElementById("toc_container").classList.remove("theme__dark");
    document.getElementById("content").classList.remove("theme__dark");
    document.getElementById("page-list").classList.remove("theme__dark");
    document.getElementById("book_header").classList.remove("theme__dark");
    document.getElementById("night_mode").innerHTML = "Nattmodus";
    document.getElementById("logo").src = "logo.svg";
    document.getElementById("modus_knapp").style.backgroundImage = "url('moon.svg')";

    if (toc_mode.style.display === "none") {
    } else {
      document.getElementById("expand_image").src = "expand.svg";
    }
  }
}

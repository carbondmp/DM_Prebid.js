import { generateUUID } from '../src/utils.js';
import { ajax } from '../src/ajax.js';
import { getStorageManager } from '../src/storageManager.js';
import {getGlobal} from '../src/prebidGlobal.js';
import adapterManager from '../src/adapterManager.js';
import adapter from '../libraries/analyticsAdapter/AnalyticsAdapter.js';
import CONSTANTS from '../src/constants.json';

const CARBON_GVL_ID = 493;
const ANALYTICS_VERSION = 'v1.0';
const CARBON_ANALYTICS_URL = 'http://pb-ing.ccgateway.net:6789';
const PROFILE_ID_KEY = 'carbon_ccuid';
const PROFILE_ID_COOKIE = 'ccuid';
const SESSION_ID_COOKIE = 'ccsid';
const MODULE_NAME = 'carbon';
const ANALYTICS_TYPE = 'endpoint';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const storage = getStorageManager({gvlid: CARBON_GVL_ID, moduleName: 'carbon'});

let enabledEvents = [];
let pageViewId = '';
let profileId = '';
let sessionId = '';
let parentId = '';
let pageEngagement = {};

let carbonAdapter = Object.assign(adapter({CARBON_ANALYTICS_URL, ANALYTICS_TYPE}), {
  track({eventType, args}) {
    if (!enabledEvents.includes(eventType)) return;
    args = args ? JSON.parse(JSON.stringify(args)) : {};
    switch (eventType) {
      case CONSTANTS.EVENTS.AUCTION_END: {
        registerEngagement();
        let event = createBaseEngagementEvent(args);
        sendEngagementEvent(event, 'auction_end');
        break;
      }
      case CONSTANTS.EVENTS.TCF2_ENFORCEMENT: {
        registerEngagement();
        let event = createBaseEngagementEvent(args);

        event.tcf_events = args; // Do we only want relevant information here?

        sendEngagementEvent(event, 'tcf_enforcement');
        break;
      }
    }
  }
});

// save the base class function
carbonAdapter.originEnableAnalytics = carbonAdapter.enableAnalytics;

// override enableAnalytics so we can get access to the config passed in from the page
carbonAdapter.enableAnalytics = function (config) {
  if (config.options) {
    parentId = config.options.parentId;
    if (config.options.enabledEvents) {
      enabledEvents = config.options.enabledEvents;
    }
  }

  pageViewId = generateUUID();
  profileId = getProfileId();
  sessionId = getSessionId();

  pageEngagement = { // create the initial page engagement event
    ttl: 60 * 1, // should be multiple of 60, unit is seconds
    count: 0,
    id: generateUUID(),
    timeLastEngage: Date.now()
  };

  let event = createBaseEngagementEvent()
  sendEngagementEvent(event, 'page_load');

  carbonAdapter.originEnableAnalytics(config); // call the base class function
};

function getProfileId() {
  if (storage.localStorageIsEnabled()) {
    let localStorageId = storage.getDataFromLocalStorage(PROFILE_ID_KEY);
    if (localStorageId && localStorageId != '') {
      if (storage.cookiesAreEnabled()) {
        storage.setCookie(PROFILE_ID_COOKIE, localStorageId, new Date(Date.now() + 89 * DAY_MS), 'Lax');
      }

      return localStorageId;
    }
  }

  if (storage.cookiesAreEnabled()) {
    let cookieId = storage.getCookie(PROFILE_ID_COOKIE);
    if (cookieId && cookieId != '') {
      if (storage.localStorageIsEnabled()) {
        storage.setDataInLocalStorage(PROFILE_ID_KEY, cookieId);
      }

      storage.setCookie(PROFILE_ID_COOKIE, cookieId, new Date(Date.now() + 89 * DAY_MS), 'Lax');

      return cookieId;
    }
  }

  let newId = generateUUID();
  if (storage.localStorageIsEnabled()) {
    storage.setDataInLocalStorage(PROFILE_ID_KEY, newId);
  }

  if (storage.cookiesAreEnabled()) {
    storage.setCookie(PROFILE_ID_COOKIE, newId, new Date(Date.now() + 89 * DAY_MS), 'Lax');
  }

  return newId;
}

function getSessionId() {
  if (storage.cookiesAreEnabled()) {
    let cookieId = storage.getCookie(SESSION_ID_COOKIE);
    if (cookieId && cookieId != '') {
      storage.setCookie(SESSION_ID_COOKIE, cookieId, new Date(Date.now() + 5 * MINUTE_MS), 'Lax');

      return cookieId;
    }
  }

  let newId = generateUUID();

  if (storage.cookiesAreEnabled()) {
    storage.setCookie(SESSION_ID_COOKIE, newId, new Date(Date.now() + 5 * MINUTE_MS), 'Lax');
  }

  return newId;
}

function registerEngagement() {
  let present = Date.now();
  let timediff = (present - pageEngagement.timeLastEngage) / 1000; // convert to seconds

  pageEngagement.timeLastEngage = present;

  if (timediff < pageEngagement.ttl) {
    return;
  }

  pageEngagement.count++;
  pageEngagement.id = generateUUID();
};

function getConsentData(args) {
  let consentData = {
    gdpr_consent: '',
    ccpa_consent: ''
  };

  if (Array.isArray(args?.bidderRequests) && args.bidderRequests.length > 0) {
    let bidderRequest = args.bidderRequests[0];

    if (bidderRequest?.gdprConsent?.consentString) {
      consentData.gdpr_consent = bidderRequest.gdprConsent.consentString;
    }

    if (bidderRequest?.uspConsent?.consentString) {
      consentData.ccpa_consent = bidderRequest.uspConsent.consentString;
    }
  }

  return consentData;
}

function getExternalIds() {
  let externalIds = {};

  if (getGlobal().getUserIdsAsEids && typeof getGlobal().getUserIdsAsEids == 'function') {
    externalIds = getGlobal().getUserIdsAsEids(); // TODO this is a grey area, we need to look further into the viability of this
  }

  return externalIds;
}

function createBaseEngagementEvent(args) {
  let event = {};

  event.profile_id = profileId;
  event.session_id = sessionId;
  event.pageview_id = pageViewId;

  event.engagement_id = pageEngagement.id;
  event.engagement_count = pageEngagement.count;
  event.engagement_ttl = pageEngagement.ttl;

  event.script_id = window.location.host;
  event.url = window.location.href;
  event.referrer = document.referrer;

  event.recieved_at = Date.now();

  if (args) {
    event.consent = getConsentData(args);
  }

  event.external_ids = getExternalIds(); // TODO check args for EIDs on subsequent auctions

  return event;
}

function sendEngagementEvent(event, eventTrigger) {
  let reqUrl = `${CARBON_ANALYTICS_URL}/${ANALYTICS_VERSION}/parent/${parentId}/engagement/trigger/${eventTrigger}`;
  ajax(reqUrl, undefined,
    JSON.stringify(event),
    {
      contentType: 'application/json',
      method: 'POST'
    }
  );
};

adapterManager.registerAnalyticsAdapter({
  adapter: carbonAdapter,
  code: MODULE_NAME,
  gvlid: CARBON_GVL_ID
});

export default carbonAdapter;

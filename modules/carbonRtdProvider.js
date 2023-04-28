/**
* This module adds the carbon provider to the Real Time Data module (rtdModule)
* The {@link module:modules/realTimeData} module is required
* The module will add contextual and audience targeting data to bid requests
* @module modules/carbonRtdProvider
* @requires module:modules/realTimeData
*/
import { submodule } from '../src/hook.js';
import { ajax } from '../src/ajax.js';
import {getGlobal} from '../src/prebidGlobal.js';
import { logError, isGptPubadsDefined, generateUUID } from '../src/utils.js';
import { getStorageManager } from '../src/storageManager.js';
import { config as sourceConfig } from '../src/config.js';

const SUBMODULE_NAME = 'carbon'
const CARBON_GVL_ID = 493;
const MODULE_VERSION = 'v1.0'
const STORAGE_KEY = 'carbon_data'
const PROFILE_ID_KEY = 'carbon_ccuid'
const TAXONOMY_RULE_EXPIRATION_KEY = 'carbon_ct_expiration'

let rtdHost = '';
let parentId = '';
let features = {};
let taxonomyRuleTTL = 600000; // default value of 10 minutes, can be overriden by config

export const storage = getStorageManager({ gvlid: CARBON_GVL_ID, moduleName: SUBMODULE_NAME })

export function setLocalStorage(carbonData) {
  let data = JSON.stringify(carbonData);
  storage.setDataInLocalStorage(STORAGE_KEY, data);
}

export function setTaxonomyRuleExpiration() {
  let expiration = Date.now() + taxonomyRuleTTL;
  storage.setDataInLocalStorage(TAXONOMY_RULE_EXPIRATION_KEY, expiration);
}

export function updateProfileId(carbonData) {
  let identity = carbonData?.profile?.identity;
  if (identity?.update && identity?.id != '' && storage.localStorageIsEnabled()) {
    storage.setDataInLocalStorage(PROFILE_ID_KEY, identity.id);
  }
}

export function matchCustomTaxonomyRule(rule) {
  const contentText = window.top.document.body.innerText;
  if (rule.MatchType == 'any') {
    let words = Object.keys(rule.WordWeights).join('|');

    let regex = RegExp('\\b' + words + '\\b', 'i');
    let result = contentText.match(regex);

    if (result) {
      return true
    }
  } else if (rule.MatchType == 'minmatch') {
    let score = 0;
    let words = Object.keys(rule.WordWeights).join('|');

    let regex = RegExp('\\b' + words + '\\b', 'gi');
    let result = contentText.match(regex);

    if (result?.length) {
      for (let match of result) {
        let point = rule.WordWeights[match];
        if (!isNaN(point)) {
          score += point;
        }

        if (score >= rule.MatchValue) {
          return true;
        }
      }
    }
  }

  return false;
}

export function matchCustomTaxonomy(rules) {
  let matchedRules = rules.filter(matchCustomTaxonomyRule);
  return matchedRules.map(x => x.Id);
}

export function prepareGPTTargeting(carbonData) {
  if (isGptPubadsDefined()) {
    setGPTTargeting(carbonData)
  } else {
    window.googletag = window.googletag || {};
    window.googletag.cmd = window.googletag.cmd || [];
    window.googletag.cmd.push(() => setGPTTargeting(carbonData));
  }
}

export function setGPTTargeting(carbonData) {
  if (Array.isArray(carbonData?.profile?.audiences)) {
    window.googletag.pubads().setTargeting('carbon_segment', carbonData.profile.audiences);
  }

  if (Array.isArray(carbonData?.context?.pageContext?.contextualclassifications)) {
    let contextSegments = carbonData.context.pageContext.contextualclassifications.map(x => {
      if (x.type && x.type == 'iab_intent' && x.id) {
        return x.id;
      }
    }).filter(x => x != undefined);
    window.googletag.pubads().setTargeting('cc-iab-class-id', contextSegments);
  }

  if (Array.isArray(carbonData?.context?.customTaxonomy)) {
    let customTaxonomyResults = matchCustomTaxonomy(carbonData.context.customTaxonomy);
    window.googletag.pubads().setTargeting('cc-custom-taxonomy', customTaxonomyResults);
  }
}

export function setPrebidConfig(carbonData) {
  const ortbData = { user: {}, site: {} };

  if (Array.isArray(carbonData?.profile?.audiences)) {
    let userSegments = carbonData.profile.audiences.map(function (x) { return { id: x } });
    ortbData.user.data = [{
      name: 'www.ccgateway.net',
      ext: { segtax: 507 }, // 507 Magnite Custom Audiences
      segment: userSegments
    }];
  }

  if (Array.isArray(carbonData?.context?.pageContext?.contextualclassifications)) {
    let contextSegments = carbonData.context.pageContext.contextualclassifications.map(function (x) {
      if (x.type && x.type == 'iab_intent' && x.id) {
        return { id: x.id };
      }
    }).filter(x => x !== undefined);
    ortbData.site.content = ortbData.site.content || {};
    ortbData.site.content.data = [{
      name: 'www.ccgateway.net',
      ext: { segtax: 2 },
      segment: contextSegments
    }];
  }

  if (Array.isArray(carbonData?.context?.customTaxonomy)) {
    ortbData.site.ext = ortbData.site.ext || {};
    ortbData.site.ext.data = ortbData.site.ext.data || {};
    ortbData.site.ext.data.customTaxonomy = matchCustomTaxonomy(carbonData.context.customTaxonomy);
  }

  if (Array.isArray(carbonData?.context?.dealIds)) {
    ortbData.site.ext = ortbData.site.ext || {};
    ortbData.site.ext.data = ortbData.site.ext.data || {};
    ortbData.site.ext.data.dealIds = carbonData.context.dealIds;
  }

  sourceConfig.mergeConfig({ortb2: ortbData});
}

export function updateRealTimeDataAsync(callback, taxonomyRules) {
  let doc = window.top.document;
  let pageUrl = `${doc.location.protocol}//${doc.location.host}${doc.location.pathname}`;

  // generate an arbitrary ID if storage is blocked so that contextual data can still be retrieved
  let profileId = storage.getDataFromLocalStorage(PROFILE_ID_KEY) || generateUUID();

  let reqUrl = new URL(`${rtdHost}/${MODULE_VERSION}/realtime/${parentId}`);
  reqUrl.searchParams.append('profile_id', profileId);
  reqUrl.searchParams.append('url', encodeURIComponent(pageUrl));

  if (getGlobal().getUserIdsAsEids && typeof getGlobal().getUserIdsAsEids == 'function') {
    let eids = getGlobal().getUserIdsAsEids();

    if (eids && eids.length) {
      eids.forEach(eid => {
        if (eid?.uids?.length) {
          eid.uids.forEach(uid => {
            reqUrl.searchParams.append('eid', `${eid.source}:${uid.id}`)
          });
        }
      });
    }
  }

  reqUrl.searchParams.append('context', (typeof features.enableContext === 'undefined') ? true : features.enableContext);
  reqUrl.searchParams.append('audience', (typeof features.enableAudience === 'undefined') ? true : features.enableAudience);
  reqUrl.searchParams.append('deal_ids', (typeof features.enableDealId === 'undefined') ? true : features.enableDealId);

  // we only want to update custom taxonomy after expiration
  if (taxonomyRules && taxonomyRules.length) {
    reqUrl.searchParams.append('custom_taxonomy', false);
  } else {
    reqUrl.searchParams.append('custom_taxonomy', (typeof features.enableCustomTaxonomy === 'undefined') ? true : features.enableCustomTaxonomy);
  }

  ajax(reqUrl, {
    success: function (response, req) {
      let carbonData = {};
      if (req.status === 200) {
        try {
          carbonData = JSON.parse(response);
        } catch (e) {
          logError('unable to parse API response');
        }

        // if custom taxonomy didn't expire use the existing data
        if (taxonomyRules?.length && carbonData?.context) {
          carbonData.context.customTaxonomy = taxonomyRules;
        } else {
          setTaxonomyRuleExpiration();
        }

        updateProfileId(carbonData);
        setPrebidConfig(carbonData);
        prepareGPTTargeting(carbonData);
        setLocalStorage(carbonData);
        callback();
      }
    },
    error: function () {
      logError('failed to retrieve targeting information');
    }
  },
  null, {
    method: 'GET',
    withCredentials: true,
    crossOrigin: true
  });
}

export function bidRequestHandler(bidReqConfig, callback, config, userConsent) {
  try {
    const carbonData = JSON.parse(storage.getDataFromLocalStorage(STORAGE_KEY) || '{}')

    if (carbonData) {
      setPrebidConfig(carbonData);
      prepareGPTTargeting(carbonData);
    }

    let updateTaxonomyRules = true;

    let taxonomyRuleExpiration = storage.getDataFromLocalStorage(TAXONOMY_RULE_EXPIRATION_KEY);
    if (taxonomyRuleExpiration && !isNaN(taxonomyRuleExpiration)) {
      updateTaxonomyRules = taxonomyRuleExpiration >= Date.now();
    }

    if (!updateTaxonomyRules && carbonData?.context?.customTaxonomy?.length) {
      updateRealTimeDataAsync(callback, carbonData.context.customTaxonomy);
    } else {
      updateRealTimeDataAsync(callback);
    }

    callback();
  } catch (err) {
    logError(err);
  }
}

function init(moduleConfig, userConsent) {
  if (moduleConfig?.params?.parentId) {
    parentId = moduleConfig.params.parentId;
  } else {
    logError('required config value "parentId" not provided');
    return false;
  }

  if (moduleConfig?.params?.endpoint) {
    rtdHost = moduleConfig.params.endpoint;
  } else {
    logError('required config value "endpoint" not provided');
    return false;
  }

  taxonomyRuleTTL = moduleConfig?.params?.cacheTTL || taxonomyRuleTTL;
  features = moduleConfig?.params?.features || features;

  return true;
}

/** @type {RtdSubmodule} */
export const carbonSubmodule = {
  name: SUBMODULE_NAME,
  getBidRequestData: bidRequestHandler,
  init: init
};

submodule('realTimeData', carbonSubmodule);

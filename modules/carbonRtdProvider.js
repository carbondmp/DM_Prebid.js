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
import { logError, isGptPubadsDefined } from '../src/utils.js';
import { getStorageManager } from '../src/storageManager.js';
import { config as sourceConfig } from '../src/config.js';

const SUBMODULE_NAME = 'carbon'
const CARBON_GVL_ID = 493;
const MODULE_VERSION = 'v1.0'
const STORAGE_KEY = 'carbon_data'
const PROFILE_ID_KEY = 'carbon_ccuid'

let rtdHost = '';
let parentId = '';
let features = {};

export const storage = getStorageManager({ gvlid: CARBON_GVL_ID, moduleName: SUBMODULE_NAME })

export function setLocalStorage(carbonData) {
  let data = JSON.stringify(carbonData);
  storage.setDataInLocalStorage(STORAGE_KEY, data);
}

export function matchCustomTaxonomyRule (rule) {
  const contentText = window.top.document.body.innerText;
  if (rule.MatchType == 'any') {
    for (let anyWord in rule.WordWeights) {
      let anyRegex = RegExp('\\b' + anyWord + '\\b', 'i');
      let anyResult = contentText.match(anyRegex);

      if (anyResult) {
        return true;
      }
    }
  } else if (rule.MatchType == 'minmatch') {
    let score = 0;
    for (let minWord in rule.WordWeights) {
      let minRegex = RegExp('\\b' + minWord + '\\b', 'gi');
      let minResult = contentText.match(minRegex);

      if (minResult) {
        score += (rule.WordWeights[minWord] * minResult.length);
      }

      if (score >= rule.MatchValue) {
        return true;
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

export function updateRealTimeDataAsync(callback, userConsent) {
  let doc = window.top.document;
  let pageUrl = `${doc.location.protocol}//${doc.location.host}${doc.location.pathname}`;
  let profileId = storage.getDataFromLocalStorage(PROFILE_ID_KEY) || '';

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

  if (features?.enableContext !== undefined) {
    reqUrl.searchParams.append('context', features.enableContext);
  }

  if (features?.enableAudience !== undefined) {
    reqUrl.searchParams.append('audience', features.enableAudience);
  }

  if (features?.enableCustomTaxonomy !== undefined) {
    reqUrl.searchParams.append('custom_taxonomy', features.enableCustomTaxonomy);
  }

  if (features?.enableDealId !== undefined) {
    reqUrl.searchParams.append('deal_ids', features.enableDealId);
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

        setPrebidConfig(carbonData);
        prepareGPTTargeting(carbonData);
        setLocalStorage(carbonData);
        callback();
      }
    },
    error: function () {
      logError('failed to retrieve targeting information');
    }
  });
}

export function bidRequestHandler(bidReqConfig, callback, config, userConsent) {
  try {
    const carbonData = JSON.parse(storage.getDataFromLocalStorage(STORAGE_KEY) || '{}')

    if (carbonData) {
      setPrebidConfig(carbonData);
      prepareGPTTargeting(carbonData);
    }
  } catch (err) {
    logError(err);
  }

  updateRealTimeDataAsync(callback, userConsent);
  callback();
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

  features = moduleConfig?.params?.features || {};

  return true;
}

/** @type {RtdSubmodule} */
export const carbonSubmodule = {
  name: SUBMODULE_NAME,
  getBidRequestData: bidRequestHandler,
  init: init
};

submodule('realTimeData', carbonSubmodule);

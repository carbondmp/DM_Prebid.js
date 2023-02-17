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
const DATA_HOST = 'https://pb-rtd.ccgateway.net'
const STORAGE_KEY = 'carbon_data'
const PROFILE_ID_KEY = 'carbon_ccuid'

export const storage = getStorageManager({ gvlid: CARBON_GVL_ID, moduleName: SUBMODULE_NAME })

export function setLocalStorage(carbonData) {
  let data = JSON.stringify(carbonData);
  storage.setDataInLocalStorage(STORAGE_KEY, data);
}

export function matchCustomTaxonomyRule (rule) {
  const contentText = window.top.document.body.innerText;
  if (rule.MatchType == 'any') {
    for (var anyWord in rule.WordWeights) {
      var anyRegex = RegExp('\\b' + anyWord + '\\b', 'i');
      var anyResult = contentText.match(anyRegex);

      if (anyResult) {
        return true;
      }
    }
  } else if (rule.MatchType == 'minmatch') {
    var score = 0;
    for (var minWord in rule.WordWeights) {
      var minRegex = RegExp('\\b' + minWord + '\\b', 'gi');
      var minResult = contentText.match(minRegex);

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
  var matchedRules = rules.filter(matchCustomTaxonomyRule);
  return matchedRules.map(x => x.Id);
}

export function setGPTTargeting(carbonData) {
  if (isGptPubadsDefined()) {
    if (carbonData.profile) {
      if (carbonData.profile.audiences && Array.isArray(carbonData.profile.audiences)) {
        window.googletag.pubads().setTargeting('carbon_segment', carbonData.profile.audiences);
      }
    }

    if (carbonData.context) {
      if (carbonData.context.pageContext && carbonData.context.pageContext.contextualclassifications && Array.isArray(carbonData.context.pageContext.contextualclassifications)) {
        var contextSegments = carbonData.context.pageContext.contextualclassifications.map(x => {
          if (x.type && x.type == 'iab_intent' && x.id) {
            return x.id;
          }
        }).filter(x => x != undefined);
        window.googletag.pubads().setTargeting('cc-iab-class-id', contextSegments);
      }

      if (carbonData.context.customTaxonomy && Array.isArray(carbonData.context.customTaxonomy)) {
        var customTaxonomyResults = matchCustomTaxonomy(carbonData.context.customTaxonomy);
        window.googletag.pubads().setTargeting('cc-custom-taxonomy', customTaxonomyResults);
      }
    }
  }
}

export function setPrebidConfig(carbonData) {
  const ortbData = { user: {}, site: {} };

  if (carbonData.profile) {
    if (carbonData.profile.audiences && Array.isArray(carbonData.profile.audiences)) {
      var userSegments = carbonData.profile.audiences.map(function (x) { return { id: x } });
      ortbData.user.data = [{
        name: 'www.ccgateway.net',
        ext: { segtax: 507 }, // 507 Magnite Custom Audiences
        segment: userSegments
      }];
    }
  }

  if (carbonData.context) {
    if (carbonData.context.pageContext && carbonData.context.pageContext.contextualclassifications && Array.isArray(carbonData.context.pageContext.contextualclassifications)) {
      var contextSegments = carbonData.context.pageContext.contextualclassifications.map(function (x) {
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

    if (carbonData.context.customTaxonomy && Array.isArray(carbonData.context.customTaxonomy)) {
      ortbData.site.ext = ortbData.site.ext || {};
      ortbData.site.ext.data = ortbData.site.ext.data || {};
      ortbData.site.ext.data.customTaxonomy = matchCustomTaxonomy(carbonData.context.customTaxonomy);
    }

    if (carbonData.context.dealIds && Array.isArray(carbonData.context.dealIds)) {
      ortbData.site.ext = ortbData.site.ext || {};
      ortbData.site.ext.data = ortbData.site.ext.data || {};
      ortbData.site.ext.data.dealIds = carbonData.context.dealIds;
    }
  }

  sourceConfig.mergeConfig({ortb2: ortbData});
}

export function updateRealTimeDataAsync(callback, moduleConfig, userConsent) {
  let doc = window.top.document;
  let pageUrl = `${doc.location.protocol}//${doc.location.host}${doc.location.pathname}`;
  let parentId = moduleConfig.params.parentId;
  let profileId = storage.getDataFromLocalStorage(PROFILE_ID_KEY) || '';

  let reqUrl = new URL(`${DATA_HOST}/${MODULE_VERSION}/realtime/${parentId}`);
  reqUrl.searchParams.append('profile_id', profileId);
  reqUrl.searchParams.append('url', encodeURIComponent(pageUrl));

  if (getGlobal().getUserIds && typeof getGlobal().getUserIds == 'function') {
    let eids = getGlobal().getUserIdsAsEids();

    if (eids && eids.length > 0) {
      for (var i = 0; i < eids.length; i++) {
        if (eids[i] && eids[i].uids && eids[i].uids.length > 0) {
          let source = eids[i].source;
          for (var ii = 0; ii < eids[i].uids.length; ii++) {
            let uid = eids[i].uids[ii].id;

            reqUrl.searchParams.append('eid', `${source}:${uid}`)
          }
        }
      }
    }
  }

  if (moduleConfig.params.features) {
    reqUrl.searchParams.append('context', moduleConfig.params.features.enableContext);
    reqUrl.searchParams.append('audience', moduleConfig.params.features.enableAudience);
    reqUrl.searchParams.append('custom_taxonomy', moduleConfig.params.features.enableCustomTaxonomy);
    reqUrl.searchParams.append('deal_ids', moduleConfig.params.features.enableDealId);
  }

  ajax(reqUrl, {
    success: function (response, req) {
      var carbonData = {};
      if (req.status === 200) {
        try {
          carbonData = JSON.parse(response);
        } catch (e) {
          logError('unable to parse API response');
        }

        setPrebidConfig(carbonData);
        setGPTTargeting(carbonData);
        setLocalStorage(carbonData);
        callback();
      }
    },
    error: function () {
      logError('failed to retrieve targeting information');
    }
  });
}

export function bidRequestHandler(bidReqConfig, callback, moduleConfig, userConsent) {
  try {
    const carbonData = JSON.parse(storage.getDataFromLocalStorage(STORAGE_KEY) || '{}')

    if (carbonData) {
      setPrebidConfig(carbonData, moduleConfig);
      setGPTTargeting(carbonData, moduleConfig);
    }
  } catch (err) {
    logError(err);
  }

  updateRealTimeDataAsync(callback, moduleConfig, userConsent);
  callback();
}

function init(moduleConfig, userConsent) {
  return true;
}

/** @type {RtdSubmodule} */
export const carbonSubmodule = {
  name: SUBMODULE_NAME,
  getBidRequestData: bidRequestHandler,
  init: init
};

submodule('realTimeData', carbonSubmodule);

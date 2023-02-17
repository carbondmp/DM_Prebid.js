import { config } from 'src/config.js'
import * as ajax from 'src/ajax.js'
import { carbonSubmodule,
  setLocalStorage,
  matchCustomTaxonomy,
  setGPTTargeting,
  setPrebidConfig,
  updateRealTimeDataAsync,
  storage,
  bidRequestHandler
} from 'modules/carbonRtdProvider.js'

const targetingData = {
  profile: {
    audiences: [
      '3049feb1-4c23-487c-a2f3-9437f65a782f',
      '93f8f5e6-6219-4c44-83d1-3e14b83b4177'
    ]
  },
  context: {
    pageContext: {
      contextualclassifications: [
        { type: 'carbon_segment_id',
          id: '11000181',
          value: 1,
          name: ''
        },
        {
          type: 'iab_intent',
          id: '269',
          value: 1,
          name: 'Hobbies \u0026 Interests.Games and Puzzles'
        },
        {
          type: 'carbon_segment_id',
          id: '20185088',
          value: 1,
          name: ''
        },
        {
          type: 'iab_intent',
          id: '375',
          value: 1,
          name: 'Music and Audio.Talk Radio.News/Talk Radio'
        }
      ]
    },
    customTaxonomy: [
      {
        Id: 'c6bb65b3-ea0e-4c6e-881d-9b3bb1f8b49f',
        MatchType: 'minmatch',
        MatchValue: 10,
        WordWeights: {
          'unit': 4,
          'test': 4,
          'prebid': 2
        }
      },
      {
        Id: 'b099fc27-1d21-42d6-af06-781b416f0ac0',
        MatchType: 'any',
        WordWeights: {
          'single': 1,
          'match': 1,
        }
      }
    ],
    dealIds: [
      'deal1',
      'deal2'
    ]
  }
}

const moduleConfig = {
  params: {
    parentId: 'testId',
    features: {
      enableContext: true,
      enableAudience: true,
      enableCustomTaxonomy: true,
      enableDealId: true
    }
  }
}

describe('carbonRtdProvider', function() {
  let ajaxStub
  let bodyStub

  beforeEach(function() {
    ajaxStub = sinon.stub(ajax, 'ajax')
    bodyStub = sinon.stub(window.top.document.body, 'innerText')
  })

  afterEach(function() {
    storage.removeDataFromLocalStorage('carbon_data')
    storage.removeDataFromLocalStorage('carbon_ccuid')
    ajaxStub.restore()
    bodyStub.restore()
    window.googletag.pubads().clearTargeting()
    config.resetConfig()
  })

  describe('carbonSubmodule', function () {
    it('should initialise and return true', function () {
      expect(carbonSubmodule.init()).to.equal(true)
    })
  })

  describe('set local storage data', function() {
    it('should sucessfully set local storage data', function() {
      setLocalStorage(targetingData)
      expect(storage.getDataFromLocalStorage('carbon_data')).to.equal(JSON.stringify(targetingData))
    })
  })

  describe('custom taxonomy rule', function() {
    it('should match custom taxonomy rule & return the id', function() {
      const rules = targetingData.context.customTaxonomy
      bodyStub.get(function() {
        return 'unit test prebid'
      })
      expect(matchCustomTaxonomy(rules)).to.eql(['c6bb65b3-ea0e-4c6e-881d-9b3bb1f8b49f'])
    })

    it('should match custom taxonomy rule & return the id', function() {
      const rules = targetingData.context.customTaxonomy
      bodyStub.get(function() {
        return 'test match'
      })
      expect(matchCustomTaxonomy(rules)).to.eql(['b099fc27-1d21-42d6-af06-781b416f0ac0'])
    })

    it('should match both custom taxonomy rules & return both ids', function() {
      const rules = targetingData.context.customTaxonomy
      bodyStub.get(function() {
        return 'unit test prebid match'
      })
      expect(matchCustomTaxonomy(rules)).to.deep.include.members(['c6bb65b3-ea0e-4c6e-881d-9b3bb1f8b49f', 'b099fc27-1d21-42d6-af06-781b416f0ac0'])
    })

    it('should fail to match custom taxonomy rule & return nothing', function() {
      const rules = targetingData.context.customTaxonomy
      bodyStub.get(function() {
        return 'irrelevant text'
      })
      expect(matchCustomTaxonomy(rules)).to.eql([])
    })
  })

  describe('set GPT targeting', function() {
    it('should set profile audience data for targeting', function() {
      setGPTTargeting(targetingData)
      expect(window.googletag.pubads().getTargeting('carbon_segment')).to.deep.include.members(['3049feb1-4c23-487c-a2f3-9437f65a782f', '93f8f5e6-6219-4c44-83d1-3e14b83b4177'])
    })

    it('should set page contextual classifications for targeting', function() {
      setGPTTargeting(targetingData)
      expect(window.googletag.pubads().getTargeting('cc-iab-class-id')).to.deep.include.members(['269', '375'])
    })

    it('should set custom taxonomy results for targeting', function() {
      bodyStub.get(function() {
        return 'unit test prebid match'
      })
      setGPTTargeting(targetingData)
      expect(window.googletag.pubads().getTargeting('cc-custom-taxonomy')).to.deep.include.members(['c6bb65b3-ea0e-4c6e-881d-9b3bb1f8b49f', 'b099fc27-1d21-42d6-af06-781b416f0ac0'])
    })
  })

  describe('set ortb targeting', function() {
    it('should set profile audience data for targeting', function() {
      setPrebidConfig(targetingData)
      expect(config.getConfig().ortb2.user.data).to.deep.include.members([{
        name: 'www.ccgateway.net',
        ext: { segtax: 507 },
        segment: [{'id': '3049feb1-4c23-487c-a2f3-9437f65a782f'}, {'id': '93f8f5e6-6219-4c44-83d1-3e14b83b4177'}]
      }])
    })

    it('should set page contextual data for targeting', function() {
      setPrebidConfig(targetingData)
      expect(config.getConfig().ortb2.site.content.data).to.deep.include.members([{
        name: 'www.ccgateway.net',
        ext: { segtax: 2 },
        segment: [{'id': '269'}, {'id': '375'}]
      }])
    })

    it('should set custom taxonomy rule matches for targeting', function() {
      bodyStub.get(function() {
        return 'unit test prebid match';
      })
      setPrebidConfig(targetingData)
      expect(config.getConfig().ortb2.site.ext.data.customTaxonomy).to.deep.include.members(['c6bb65b3-ea0e-4c6e-881d-9b3bb1f8b49f', 'b099fc27-1d21-42d6-af06-781b416f0ac0'])
    })

    it('should set deal ids for targeting', function() {
      setPrebidConfig(targetingData)
      expect(config.getConfig().ortb2.site.ext.data.dealIds).to.deep.include.members(['deal1', 'deal2'])
    })
  })

  describe('update realtime data async request', function() {
    it('should make a request to the rtd server', function() {
      ajaxStub.callsFake(function() {
        return function(url, callback) {
          const fakeResponse = sinon.stub();
          fakeResponse.returns('headerContent');
          callback.success(JSON.stringify(targetingData), { getResponseHeader: fakeResponse });
        }
      })
      let callbackStub = sinon.stub()
      storage.setDataInLocalStorage('carbon_ccuid', 'a7939741-8a3c-4476-9138-b3fb73edc885')
      updateRealTimeDataAsync(callbackStub, moduleConfig)

      const requestUrl = new URL(ajaxStub.firstCall.args[0])

      expect(ajaxStub.calledOnce).to.equal(true)
      expect(requestUrl.pathname).to.equal('/v1.0/realtime/testId')
      expect(requestUrl.searchParams.get('profile_id')).to.equal('a7939741-8a3c-4476-9138-b3fb73edc885')
      expect(requestUrl.searchParams.get('context')).to.equal('true')
      expect(requestUrl.searchParams.get('audience')).to.equal('true')
      expect(requestUrl.searchParams.get('custom_taxonomy')).to.equal('true')
      expect(requestUrl.searchParams.get('deal_ids')).to.equal('true')
    })
  })

  describe('bid request handler function', function() {
    it('should take local data, set targeting & make a background request to update data', function() {
      ajaxStub.callsFake(function() {
        return function(url, callback) {
          const fakeResponse = sinon.stub();
          fakeResponse.returns('headerContent');
          callback.success(JSON.stringify(targetingData), { getResponseHeader: fakeResponse });
        }
      })
      bodyStub.get(function() {
        return 'unit test prebid match'
      })
      let callbackStub = sinon.stub()

      storage.setDataInLocalStorage('carbon_ccuid', 'a7939741-8a3c-4476-9138-b3fb73edc885')
      setLocalStorage(targetingData)

      bidRequestHandler({}, callbackStub, moduleConfig, {})
      const requestUrl = new URL(ajaxStub.firstCall.args[0])

      expect(window.googletag.pubads().getTargeting('carbon_segment')).to.deep.include.members(['3049feb1-4c23-487c-a2f3-9437f65a782f', '93f8f5e6-6219-4c44-83d1-3e14b83b4177'])
      expect(window.googletag.pubads().getTargeting('cc-iab-class-id')).to.deep.include.members(['269', '375'])
      expect(window.googletag.pubads().getTargeting('cc-custom-taxonomy')).to.deep.include.members(['c6bb65b3-ea0e-4c6e-881d-9b3bb1f8b49f', 'b099fc27-1d21-42d6-af06-781b416f0ac0'])

      expect(config.getConfig().ortb2.user.data).to.deep.include.members([{
        name: 'www.ccgateway.net',
        ext: { segtax: 507 },
        segment: [{'id': '3049feb1-4c23-487c-a2f3-9437f65a782f'}, {'id': '93f8f5e6-6219-4c44-83d1-3e14b83b4177'}]
      }])
      expect(config.getConfig().ortb2.site.content.data).to.deep.include.members([{
        name: 'www.ccgateway.net',
        ext: { segtax: 2 },
        segment: [{'id': '269'}, {'id': '375'}]
      }])
      expect(config.getConfig().ortb2.site.ext.data.customTaxonomy).to.deep.include.members(['c6bb65b3-ea0e-4c6e-881d-9b3bb1f8b49f', 'b099fc27-1d21-42d6-af06-781b416f0ac0'])
      expect(config.getConfig().ortb2.site.ext.data.dealIds).to.deep.include.members(['deal1', 'deal2'])

      expect(ajaxStub.calledOnce).to.equal(true)
      expect(requestUrl.pathname).to.equal('/v1.0/realtime/testId')
      expect(requestUrl.searchParams.get('profile_id')).to.equal('a7939741-8a3c-4476-9138-b3fb73edc885')
      expect(requestUrl.searchParams.get('context')).to.equal('true')
      expect(requestUrl.searchParams.get('audience')).to.equal('true')
      expect(requestUrl.searchParams.get('custom_taxonomy')).to.equal('true')
      expect(requestUrl.searchParams.get('deal_ids')).to.equal('true')
    })
  })
})

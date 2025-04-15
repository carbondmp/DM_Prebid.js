import * as ajax from 'src/ajax.js'
import { carbonSubmodule,
  setLocalStorage,
  matchCustomTaxonomy,
  setGPTTargeting,
  fetchRealTimeData,
  storage,
  bidRequestHandler,
  updateProfileId
} from 'modules/carbonRtdProvider.js'

const targetingData = {
  profile: {
    identity: {
      id: '7d40ac1d-e7d2-4979-90a1-6204b80d12f5',
      update: true
    },
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
    customTaxonomyTTL: 600000,
    dealIds: [
      'deal1',
      'deal2'
    ]
  }
}

const moduleConfig = {
  params: {
    parentId: 'testId',
    endpoint: 'http://test.example.com',
    features: {
      context: {
        active: true,
        pushGpt: true,
        limit: 10
      },
      audience: {
        active: true,
        pushGpt: true,
        limit: 20
      },
      customTaxonomy: {
        active: true,
        pushGpt: true,
        limit: 30
      },
      dealId: {
        active: true,
        pushGpt: true,
        limit: 40
      }
    }
  }
}

describe('carbonRtdProvider', function() {
  let ajaxStub
  let bodyStub

  beforeEach(function() {
    ajaxStub = sinon.stub(ajax, 'ajax')
    bodyStub = sinon.stub(window.top.document.body, 'innerText')

    let fakeStore = {};
    window.googletag = {
      pubads: sinon.stub().returns({
        clearTargeting: sinon.stub().callsFake(() => fakeStore = {}),
        getTargeting: sinon.stub().callsFake((key) => fakeStore[key]),
        setTargeting: sinon.stub().callsFake((key, value) => fakeStore[key] = value)
      }),
      cmd: { push: sinon.spy() }
    };
  })

  afterEach(function() {
    storage.removeDataFromLocalStorage('carbon_data')
    storage.removeDataFromLocalStorage('carbon_ccuid')
    ajaxStub.restore()
    bodyStub.restore()
    window.googletag.pubads().clearTargeting();
  })

  describe('carbonSubmodule', function () {
    it('should fail to initialise without config and return false', function () {
      expect(carbonSubmodule.init()).to.equal(false)
    })

    it('should initialise and return true', function () {
      expect(carbonSubmodule.init(moduleConfig)).to.equal(true)
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

  describe('bid request handler function', function(done) {
    it('should take local data, set targeting & make a background request to update data', function() {
      bodyStub.get(function() {
        return 'unit test prebid match'
      })

      ajaxStub.callsFake(function() {
        return function(url, callback) {
          const fakeResponse = sinon.stub();
          fakeResponse.returns('headerContent');
          callback.success(JSON.stringify(targetingData), { getResponseHeader: fakeResponse });
        }
      })

      let callbackStub = sinon.stub()

      bidRequestHandler({}, callbackStub, moduleConfig, {})

      setTimeout(() => {
        expect(ajaxStub.calledOnce).to.equal(true)

        const requestUrl = new URL(ajaxStub.firstCall.args[0])

        expect(requestUrl.pathname).to.equal('/v1.0/realtime/testId')
        expect(requestUrl.searchParams.get('profile_id')).to.equal('a7939741-8a3c-4476-9138-b3fb73edc885')

        expect(requestUrl.searchParams.get('context')).to.equal('true')
        expect(requestUrl.searchParams.get('contextLimit')).to.equal('10')

        expect(requestUrl.searchParams.get('audience')).to.equal('true')
        expect(requestUrl.searchParams.get('audienceLimit')).to.equal('20')

        expect(requestUrl.searchParams.get('custom_taxonomy')).to.equal('true')
        expect(requestUrl.searchParams.get('customTaxonomyLimit')).to.equal('30')

        expect(requestUrl.searchParams.get('deal_ids')).to.equal('true')
        expect(requestUrl.searchParams.get('dealIdLimit')).to.equal('40')

        expect(window.googletag.pubads().getTargeting('carbon_segment')).to.deep.include.members(['3049feb1-4c23-487c-a2f3-9437f65a782f', '93f8f5e6-6219-4c44-83d1-3e14b83b4177'])
        expect(window.googletag.pubads().getTargeting('cc-iab-class-id')).to.deep.include.members(['269', '375'])
        expect(window.googletag.pubads().getTargeting('cc-custom-taxonomy')).to.deep.include.members(['c6bb65b3-ea0e-4c6e-881d-9b3bb1f8b49f', 'b099fc27-1d21-42d6-af06-781b416f0ac0'])
        done()
      }, 50)
    })
  })

  describe('update profile ID', function() {
    it('should update the profile ID in local storage', function() {
      updateProfileId(targetingData)
      expect(storage.getDataFromLocalStorage('carbon_ccuid')).to.equal('7d40ac1d-e7d2-4979-90a1-6204b80d12f5')
    })
  })
})

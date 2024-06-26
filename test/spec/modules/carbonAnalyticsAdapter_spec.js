import * as utils from 'src/utils'
import * as ajax from 'src/ajax'
import * as events from 'src/events';
import { carbonAdapter,
  updateProfileId,
  storage
} from 'modules/carbonAnalyticsAdapter'
import CONSTANTS from 'src/constants.json';

const auctionEndEvent = {
  bidderRequests: [
    {
      gdprConsent: {
        consentString: 'testGDPR'
      },
      uspConsent: {
        consentString: 'testUSP'
      }
    }
  ]
}

const tcfEvent = {
  storageBlocked: ['moduleA', 'moduleB'],
  biddersBlocked: ['moduleB'],
  analyticsBlocked: ['moduleC']
}

describe('carbonAnalyticsAdapter', function() {
  let ajaxStub
  let dateStub
  let eventStub
  let uuidStub

  beforeEach(function() {
    ajaxStub = sinon.stub(ajax, 'ajax')
    dateStub = sinon.stub(Date, 'now')
    eventStub = sinon.stub(events, 'getEvents').returns([]);
    uuidStub = sinon.stub(utils, 'generateUUID')
    sinon.spy(carbonAdapter, 'track')
  })

  afterEach(function() {
    ajaxStub.restore()
    dateStub.restore()
    eventStub.restore()
    uuidStub.restore()
    carbonAdapter.track.restore()
    carbonAdapter.disableAnalytics()
  })

  describe('enableAnalytics', function() {
    it('should initialise the adapter, creating an empty engagement', function() {
      dateStub.returns(1000000000000)
      uuidStub.onCall(0).returns('test_pageview_id')
      uuidStub.onCall(1).returns('test_profile_id')
      uuidStub.onCall(2).returns('test_session_id')
      uuidStub.onCall(3).returns('test_engagement_id')

      carbonAdapter.enableAnalytics({
        provider: 'carbon',
        options: {
          parentId: 'aaabbb',
          endpoint: 'http://test.example.com',
          eventBuffer: 1000
        }
      })

      const requestUrl = new URL(ajaxStub.firstCall.args[0])
      const requestBody = JSON.parse(ajaxStub.firstCall.args[2])

      expect(requestUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/page_load')
      expect(requestBody.pageview_id).to.equal('test_pageview_id')
      expect(requestBody.profile_id).to.equal('test_profile_id')
      expect(requestBody.session_id).to.equal('test_session_id')
      expect(requestBody.engagement_id).to.equal('test_engagement_id')
      expect(requestBody.engagement_count).to.equal(0)
      expect(requestBody.engagement_ttl).to.equal(60)
      expect(requestBody.start_time).to.equal(1000000000000)
    })
  })

  describe('track auction end', function() {
    beforeEach(function() {
      dateStub.returns(1000000000000)
      uuidStub.onCall(0).returns('test_pageview_id')
      uuidStub.onCall(1).returns('test_profile_id')
      uuidStub.onCall(2).returns('test_session_id')
      uuidStub.onCall(3).returns('test_engagement_id')

      carbonAdapter.enableAnalytics({
        provider: 'carbon',
        options: {
          parentId: 'aaabbb',
          endpoint: 'http://test.example.com',
          eventBuffer: 1000
        }
      })

      ajaxStub.resetHistory()
      dateStub.resetHistory()
      uuidStub.resetHistory()
    })

    it('should track an auction end event & get consent data from bids', function() {
      sinon.spy()
      events.emit(CONSTANTS.EVENTS.AUCTION_END, auctionEndEvent)

      expect(ajaxStub.calledOnce).to.equal(true)

      const auctionEndUrl = new URL(ajaxStub.firstCall.args[0])
      const auctionEndBody = JSON.parse(ajaxStub.firstCall.args[2])

      expect(auctionEndUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/auction_end')
      expect(auctionEndBody.consent.gdpr_consent).to.equal('testGDPR')
      expect(auctionEndBody.consent.ccpa_consent).to.equal('testUSP')
      expect(auctionEndBody.start_time).to.equal(1000000000000)
    })

    it('should generate a new engagement', function() {
      dateStub.onCall(0).returns(1000001000000)
      dateStub.onCall(1).returns(1000001000010)
      dateStub.onCall(2).returns(1000001000010)
      uuidStub.onCall(0).returns('test_engagement_id_2')

      events.emit(CONSTANTS.EVENTS.AUCTION_END, auctionEndEvent)

      expect(ajaxStub.calledOnce).to.equal(true)

      const auctionEndUrl = new URL(ajaxStub.firstCall.args[0])
      const auctionEndBody = JSON.parse(ajaxStub.firstCall.args[2])

      expect(auctionEndUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/auction_end')
      expect(auctionEndBody.consent.gdpr_consent).to.equal('testGDPR')
      expect(auctionEndBody.consent.ccpa_consent).to.equal('testUSP')
      expect(auctionEndBody.engagement_id).to.equal('test_engagement_id_2')
      expect(auctionEndBody.engagement_count).to.equal(1)
      expect(auctionEndBody.engagement_ttl).to.equal(60)
      expect(auctionEndBody.end_time).to.equal(1000001000010)
    })

    it('should prevent multiple events within the buffer interval', function() {
      sinon.spy()
      dateStub.onCall(0).returns(1000002000000)
      dateStub.onCall(1).returns(1000002000010)
      dateStub.onCall(2).returns(1000002000010)
      dateStub.onCall(3).returns(1000002000000)
      dateStub.onCall(4).returns(1000002000010)
      dateStub.onCall(5).returns(1000002000010)

      events.emit(CONSTANTS.EVENTS.AUCTION_END, auctionEndEvent)
      events.emit(CONSTANTS.EVENTS.AUCTION_END, auctionEndEvent)

      expect(ajaxStub.calledOnce).to.equal(true)

      const auctionEndUrl = new URL(ajaxStub.firstCall.args[0])
      const auctionEndBody = JSON.parse(ajaxStub.firstCall.args[2])

      expect(auctionEndUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/auction_end')
      expect(auctionEndBody.consent.gdpr_consent).to.equal('testGDPR')
      expect(auctionEndBody.consent.ccpa_consent).to.equal('testUSP')
      expect(auctionEndBody.start_time).to.equal(1000002000000)
    })
  })

  describe('update profile ID', function() {
    beforeEach(function() {
      carbonAdapter.enableAnalytics({
        provider: 'carbon',
        options: {
          parentId: 'aaabbb',
          endpoint: 'http://test.example.com',
          eventBuffer: 1000
        }
      })

      ajaxStub.resetHistory()
      dateStub.resetHistory()
      uuidStub.resetHistory()
    })

    it('should set the cookie value in local storage', function() {
      let eventResponse = {
        update: true,
        id: 'd950b592-879b-4c34-884a-bec201115ab9'
      }

      updateProfileId(eventResponse)

      expect(storage.getDataFromLocalStorage('carbon_ccuid')).to.equal('d950b592-879b-4c34-884a-bec201115ab9')
      expect(storage.getCookie('ccuid')).to.equal('d950b592-879b-4c34-884a-bec201115ab9')
    })
  })

  describe('cookie deprecation label tests', function() {
    let navigatorStub

    beforeEach(function() {
      if (navigator && !navigator.cookieDeprecationLabel) {
        navigator.cookieDeprecationLabel = {
          getValue: function() {}
        }
      }

      navigatorStub = sinon.stub(navigator.cookieDeprecationLabel, 'getValue')
      navigatorStub.resolves('test_label')

      carbonAdapter.enableAnalytics({
        provider: 'carbon',
        options: {
          parentId: 'aaabbb',
          endpoint: 'http://test.example.com',
          eventBuffer: 1000
        }
      })
      ajaxStub.resetHistory()
      navigatorStub.resetHistory()
    })

    it('should track an auction end event with a cookie deprecation label', function() {
      sinon.spy()
      events.emit(CONSTANTS.EVENTS.AUCTION_END, auctionEndEvent)

      setTimeout(() => {
        expect(ajaxStub.calledOnce).to.equal(true)

        const auctionEndUrl = new URL(ajaxStub.firstCall.args[0])
        const auctionEndBody = JSON.parse(ajaxStub.firstCall.args[2])

        expect(auctionEndUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/auction_end')
        expect(auctionEndBody.cookieDeprecationLabel).to.equal('test_label')
      }, 100)
    })
  })
})

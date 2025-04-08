import * as utils from 'src/utils'
import * as ajax from 'src/ajax'
import * as events from 'src/events';
import { carbonAdapter,
  updateProfileId,
  storage
} from 'modules/carbonAnalyticsAdapter'
import CONSTANTS from 'src/constants.json';

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

    sinon.stub(storage, 'cookiesAreEnabled').returns(true);
    sinon.stub(storage, 'localStorageIsEnabled').returns(true);

    const fakeStore = {};
    sinon.stub(storage, 'setCookie').callsFake((key, value) => {
      fakeStore[key] = value;
    });
    sinon.stub(storage, 'getCookie').callsFake((key) => fakeStore[key]);

    sinon.stub(storage, 'setDataInLocalStorage').callsFake((key, value) => {
      fakeStore[key] = value;
    });
    sinon.stub(storage, 'getDataFromLocalStorage').callsFake((key) => fakeStore[key]);

    window.__tcfapi = (cmd, ver, callback) => {
      const success = true;
      const data = {
        gdprApplies: true,
        tcString: 'testGDPR',
        vendor: { consents: { 493: true } }
      };
      callback(data, success);
    };

    window.__uspapi = (cmd, ver, callback) => {
      const success = true;
      const data = { uspString: '1YYY' };
      callback(data, success);
    };

    sinon.spy(carbonAdapter, 'track')
  })

  afterEach(function() {
    ajaxStub.restore()
    dateStub.restore()
    eventStub.restore()
    uuidStub.restore()

    storage.cookiesAreEnabled.restore();
    storage.localStorageIsEnabled.restore();
    storage.setCookie.restore();
    storage.getCookie.restore();
    storage.setDataInLocalStorage.restore();
    storage.getDataFromLocalStorage.restore();

    carbonAdapter.track.restore()
    carbonAdapter.disableAnalytics()
  })

  describe('enableAnalytics', function() {
    it('should initialise the adapter, creating an empty engagement', function(done) {
      dateStub.returns(1000000000000)
      uuidStub.onCall(0).returns('test_pageview_id')
      uuidStub.onCall(1).returns('test_engagement_id')

      storage.setDataInLocalStorage('carbon_ccuid', 'test_profile_id')
      storage.setCookie('ccsid', 'test_session_id')

      carbonAdapter.enableAnalytics({
        provider: 'carbon',
        options: {
          parentId: 'aaabbb',
          endpoint: 'http://test.example.com',
          eventBuffer: 1000
        }
      })

      setTimeout(() => {
        expect(ajaxStub.calledOnce).to.equal(true);

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

        done()
      }, 50)
    })
  })

  describe('track auction end', function() {
    beforeEach(function(done) {
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

      setTimeout(() => {
        ajaxStub.resetHistory()
        dateStub.resetHistory()
        uuidStub.resetHistory()
        done()
      }, 50)
    })

    it('should track an auction end event & get consent data', function(done) {
      sinon.spy()
      events.emit(CONSTANTS.EVENTS.AUCTION_END, {})

      setTimeout(() => {
        expect(ajaxStub.calledOnce).to.equal(true)

        const auctionEndUrl = new URL(ajaxStub.firstCall.args[0])
        const auctionEndBody = JSON.parse(ajaxStub.firstCall.args[2])

        expect(auctionEndUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/auction_end')
        expect(auctionEndBody.consent.gdpr_consent).to.equal('testGDPR')
        expect(auctionEndBody.consent.ccpa_consent).to.equal('1YYY')
        expect(auctionEndBody.start_time).to.equal(1000000000000)

        done();
      }, 50);
    })

    it('should generate a new engagement', function(done) {
      dateStub.returns(1000001000010)
      uuidStub.onCall(0).returns('test_engagement_id_2')

      events.emit(CONSTANTS.EVENTS.AUCTION_END, {})

      setTimeout(() => {
        expect(ajaxStub.calledOnce).to.equal(true)

        const auctionEndUrl = new URL(ajaxStub.firstCall.args[0])
        const auctionEndBody = JSON.parse(ajaxStub.firstCall.args[2])

        expect(auctionEndUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/auction_end')
        expect(auctionEndBody.consent.gdpr_consent).to.equal('testGDPR')
        expect(auctionEndBody.consent.ccpa_consent).to.equal('1YYY')
        expect(auctionEndBody.engagement_id).to.equal('test_engagement_id_2')
        expect(auctionEndBody.engagement_count).to.equal(1)
        expect(auctionEndBody.engagement_ttl).to.equal(60)
        expect(auctionEndBody.end_time).to.equal(1000001000010)

        done()
      });
    })

    it('should prevent multiple events within the buffer interval', function(done) {
      sinon.spy()
      dateStub.onCall(0).returns(1000002000000)
      dateStub.onCall(1).returns(1000002000010)
      dateStub.onCall(2).returns(1000002000010)

      dateStub.onCall(3).returns(1000002000000)
      dateStub.onCall(4).returns(1000002000010)
      dateStub.onCall(5).returns(1000002000010)

      events.emit(CONSTANTS.EVENTS.AUCTION_END, {})
      events.emit(CONSTANTS.EVENTS.AUCTION_END, {})

      setTimeout(() => {
        expect(ajaxStub.calledOnce).to.equal(true)

        const auctionEndUrl = new URL(ajaxStub.firstCall.args[0])
        const auctionEndBody = JSON.parse(ajaxStub.firstCall.args[2])

        expect(auctionEndUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/auction_end')
        expect(auctionEndBody.consent.gdpr_consent).to.equal('testGDPR')
        expect(auctionEndBody.consent.ccpa_consent).to.equal('1YYY')
        expect(auctionEndBody.start_time).to.equal(1000002000000)

        done()
      }, 50);
    })
  })

  describe('update profile ID', function() {
    beforeEach(function(done) {
      carbonAdapter.enableAnalytics({
        provider: 'carbon',
        options: {
          parentId: 'aaabbb',
          endpoint: 'http://test.example.com',
          eventBuffer: 1000
        }
      })

      setTimeout(() => {
        ajaxStub.resetHistory()
        dateStub.resetHistory()
        uuidStub.resetHistory()
        done()
      }, 50)
    })

    it('should set the cookie value in local storage', function(done) {
      let eventResponse = {
        update: true,
        id: 'd950b592-879b-4c34-884a-bec201115ab9'
      }

      updateProfileId(eventResponse)

      expect(storage.getDataFromLocalStorage('carbon_ccuid')).to.equal('d950b592-879b-4c34-884a-bec201115ab9')
      expect(storage.getCookie('ccuid')).to.equal('d950b592-879b-4c34-884a-bec201115ab9')

      done()
    })
  })

  describe('cookie deprecation label tests', function() {
    let navigatorStub

    beforeEach(function(done) {
      dateStub.returns(1000003000000);

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

      setTimeout(() => {
        ajaxStub.resetHistory()
        navigatorStub.resetHistory()
        done()
      }, 50)
    })

    it('should track an auction end event with a cookie deprecation label', function(done) {
      sinon.spy()
      events.emit(CONSTANTS.EVENTS.AUCTION_END, {})

      setTimeout(() => {
        expect(ajaxStub.calledOnce).to.equal(true)

        const auctionEndUrl = new URL(ajaxStub.firstCall.args[0])
        const auctionEndBody = JSON.parse(ajaxStub.firstCall.args[2])

        // eslint-disable-next-line no-console
        console.log(auctionEndUrl.pathname)

        expect(auctionEndUrl.pathname).to.equal('/v1.0/parent/aaabbb/engagement/trigger/auction_end')
        expect(auctionEndBody.cookieDeprecationLabel).to.equal('test_label')

        done()
      }, 100)
    })
  })
})

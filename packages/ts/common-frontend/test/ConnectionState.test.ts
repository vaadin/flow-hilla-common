import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { assert, expect, chai, describe, it } from 'vitest';
import { ConnectionState, ConnectionStateStore, isLocalhost } from '../src/index.js';

chai.use(sinonChai);

describe('ConnectionStateStore', () => {
  it('should call state change listeners when transitioning between states', () => {
    const store = new ConnectionStateStore(ConnectionState.CONNECTED);
    const stateChangeListener1 = sinon.fake();
    const stateChangeListener2 = sinon.fake();
    store.addStateChangeListener(stateChangeListener1);
    store.addStateChangeListener(stateChangeListener2);

    expect(stateChangeListener1).to.not.be.called;
    expect(stateChangeListener2).to.not.be.called;

    store.state = ConnectionState.CONNECTION_LOST;

    expect(stateChangeListener1).to.be.calledOnce;
    expect(stateChangeListener2).to.be.calledOnce;
  });

  it('should have removable state change listeners', () => {
    const store = new ConnectionStateStore(ConnectionState.CONNECTED);
    const stateChangeListener = sinon.fake();
    store.addStateChangeListener(stateChangeListener);

    store.removeStateChangeListener(stateChangeListener);
    store.state = ConnectionState.CONNECTION_LOST;
    expect(stateChangeListener).to.not.be.called;
  });

  it('state change listeners should be idempotent with respect to state update', () => {
    const store = new ConnectionStateStore(ConnectionState.CONNECTED);
    const stateChangeListener = sinon.fake();
    store.addStateChangeListener(stateChangeListener);

    store.state = ConnectionState.CONNECTION_LOST;
    store.state = ConnectionState.CONNECTION_LOST;

    expect(stateChangeListener).to.be.calledOnce;
  });

  it('state change listeners should be idempotent with respect to addStateChangeListener', () => {
    const store = new ConnectionStateStore(ConnectionState.CONNECTED);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const stateChangeListener = sinon.spy((_: ConnectionState, __: ConnectionState) => {});

    store.addStateChangeListener(stateChangeListener);
    store.addStateChangeListener(stateChangeListener);
    store.state = ConnectionState.CONNECTION_LOST;

    expect(stateChangeListener).to.be.calledOnce;
  });

  it('LOADING states are stacked', () => {
    const store = new ConnectionStateStore(ConnectionState.CONNECTED);
    const stateChangeListener = sinon.fake();
    store.addStateChangeListener(stateChangeListener);

    store.loadingStarted();
    store.loadingStarted();
    store.loadingFinished();
    store.loadingFinished();

    assert.equal(stateChangeListener.callCount, 2);

    expect(stateChangeListener.getCall(0)).to.be.calledWithExactly(ConnectionState.CONNECTED, ConnectionState.LOADING);
    expect(stateChangeListener.getCall(1)).to.be.calledWithExactly(ConnectionState.LOADING, ConnectionState.CONNECTED);
  });

  it('loading count should reset when state forced', () => {
    const store = new ConnectionStateStore(ConnectionState.CONNECTED);
    const stateChangeListener = sinon.fake();
    store.addStateChangeListener(stateChangeListener);

    store.loadingStarted();
    store.state = ConnectionState.CONNECTION_LOST;
    store.loadingStarted();
    store.loadingFinished();

    assert.equal(stateChangeListener.callCount, 4);

    expect(stateChangeListener.getCall(0)).to.be.calledWithExactly(ConnectionState.CONNECTED, ConnectionState.LOADING);
    expect(stateChangeListener.getCall(1)).to.be.calledWithExactly(
      ConnectionState.LOADING,
      ConnectionState.CONNECTION_LOST,
    );
    expect(stateChangeListener.getCall(2)).to.be.calledWithExactly(
      ConnectionState.CONNECTION_LOST,
      ConnectionState.LOADING,
    );
    expect(stateChangeListener.getCall(3)).to.be.calledWithExactly(ConnectionState.LOADING, ConnectionState.CONNECTED);
  });

  it('loadingFailed should set state to CONNECTION_LOST', () => {
    const store = new ConnectionStateStore(ConnectionState.CONNECTION_LOST);
    const stateChangeListener = sinon.fake();
    store.addStateChangeListener(stateChangeListener);

    store.loadingStarted();
    store.loadingFailed();

    assert.equal(stateChangeListener.callCount, 2);
    expect(stateChangeListener.getCall(0)).to.be.calledWithExactly(
      ConnectionState.CONNECTION_LOST,
      ConnectionState.LOADING,
    );
    expect(stateChangeListener.getCall(1)).to.be.calledWithExactly(
      ConnectionState.LOADING,
      ConnectionState.CONNECTION_LOST,
    );
  });

  it('should request offline information from from service worker', async () => {
    const $wnd = window as any;

    const fakeServiceWorker = new EventTarget();
    const addEventListener = sinon.spy(fakeServiceWorker, 'addEventListener');
    const removeEventListener = sinon.spy(fakeServiceWorker, 'removeEventListener');

    const navigatorStub = sinon.stub($wnd, 'navigator').get(() => ({ serviceWorker: fakeServiceWorker }));

    try {
      const postMessage = sinon.spy();
      const fakePromise = Promise.resolve({ active: { postMessage } });
      Object.defineProperty(fakeServiceWorker, 'ready', { value: fakePromise });

      const store = new ConnectionStateStore(ConnectionState.CONNECTED);
      // should add message event listener on service worker
      expect(addEventListener).to.be.calledOnce;
      expect(addEventListener).to.be.calledWith('message', sinon.match.func);

      // should send {type: "isConnectionLost"} to service worker
      await fakePromise;
      expect(postMessage).to.be.calledOnce;
      expect(postMessage).to.be.calledWith({
        method: 'Vaadin.ServiceWorker.isConnectionLost',
        id: 'Vaadin.ServiceWorker.isConnectionLost',
      });

      // should transition to CONNECTION_LOST when receiving {result: true}
      const messageEvent = new MessageEvent('message', {
        data: {
          id: 'Vaadin.ServiceWorker.isConnectionLost',
          result: true,
        },
      }) as any;

      fakeServiceWorker.dispatchEvent(messageEvent);
      assert.equal(store.state, ConnectionState.CONNECTION_LOST);

      // should remove message event listener on service worker
      expect(removeEventListener).to.be.calledOnce;
      expect(removeEventListener).to.be.calledWith('message', sinon.match.func);
    } finally {
      navigatorStub.restore();
    }
  });
  it('should know which hosts are localhost', () => {
    expect(isLocalhost('localhost')).to.be.true;
    expect(isLocalhost('127.0.0.1')).to.be.true;
    expect(isLocalhost('127.0.0.2')).to.be.true;
    expect(isLocalhost('127.1.2.3')).to.be.true;
    expect(isLocalhost('[::1]')).to.be.true;
    expect(isLocalhost('::1')).to.be.false;
    expect(isLocalhost('127.0.0.1.com')).to.be.false;
    expect(isLocalhost('foo127.0.0.1')).to.be.false;
    expect(isLocalhost('localhost.com')).to.be.false;
    expect(isLocalhost('my.localhost')).to.be.false;
  });
});

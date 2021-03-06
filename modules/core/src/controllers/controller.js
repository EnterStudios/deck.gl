// Copyright (c) 2015 Uber Technologies, Inc.

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import LinearInterpolator from '../transitions/linear-interpolator';
import TransitionManager, {TRANSITION_EVENTS} from './transition-manager';
import assert from '../utils/assert';

const NO_TRANSITION_PROPS = {
  transitionDuration: 0
};

const LINEAR_TRANSITION_PROPS = {
  transitionDuration: 300,
  transitionEasing: t => t,
  transitionInterpolator: new LinearInterpolator(),
  transitionInterruption: TRANSITION_EVENTS.BREAK
};

// EVENT HANDLING PARAMETERS
const PITCH_MOUSE_THRESHOLD = 5;
const PITCH_ACCEL = 1.2;
const ZOOM_ACCEL = 0.01;

const EVENT_TYPES = {
  WHEEL: ['wheel'],
  PAN: ['panstart', 'panmove', 'panend'],
  PINCH: ['pinchstart', 'pinchmove', 'pinchend'],
  DOUBLE_TAP: ['doubletap'],
  KEYBOARD: ['keydown']
};

export default class Controller {
  constructor(ControllerState, options = {}) {
    assert(ControllerState);
    this.ControllerState = ControllerState;
    this.controllerState = null;
    this.controllerStateProps = null;
    this.eventManager = null;
    this.transitionManager = new TransitionManager(ControllerState, options);
    this._events = null;
    this._state = {
      isDragging: false
    };
    this.events = [];
    this.onViewportChange = null;
    this.onViewStateChange = null;
    this.onStateChange = null;
    this.invertPan = false;

    this.handleEvent = this.handleEvent.bind(this);

    this.setProps(options);
  }

  finalize() {}

  /**
   * Callback for events
   * @param {hammer.Event} event
   */
  handleEvent(event) {
    const {ControllerState} = this;
    this.controllerState = new ControllerState(
      Object.assign({}, this.controllerStateProps, this._state)
    );

    switch (event.type) {
      case 'panstart':
        return this._onPanStart(event);
      case 'panmove':
        return this._onPan(event);
      case 'panend':
        return this._onPanEnd(event);
      case 'pinchstart':
        return this._onPinchStart(event);
      case 'pinchmove':
        return this._onPinch(event);
      case 'pinchend':
        return this._onPinchEnd(event);
      case 'doubletap':
        return this._onDoubleTap(event);
      case 'wheel':
        return this._onWheel(event);
      case 'keydown':
        return this._onKeyDown(event);
      default:
        return false;
    }
  }

  /* Event utils */
  // Event object: http://hammerjs.github.io/api/#event-object
  getCenter(event) {
    const {x, y} = this.controllerStateProps;
    const {offsetCenter} = event;
    return [offsetCenter.x - x, offsetCenter.y - y];
  }

  isPointInBounds(pos) {
    const {width, height} = this.controllerStateProps;

    return pos[0] >= 0 && pos[0] <= width && pos[1] >= 0 && pos[1] <= height;
  }

  isFunctionKeyPressed(event) {
    const {srcEvent} = event;
    return Boolean(srcEvent.metaKey || srcEvent.altKey || srcEvent.ctrlKey || srcEvent.shiftKey);
  }

  isDragging() {
    return this._state.isDragging;
  }

  /**
   * Extract interactivity options
   */
  /* eslint-disable complexity, max-statements */
  setProps(props) {
    if ('onViewportChange' in props) {
      this.onViewportChange = props.onViewportChange;
    }
    if ('onViewStateChange' in props) {
      this.onViewStateChange = props.onViewStateChange;
    }
    if ('onStateChange' in props) {
      this.onStateChange = props.onStateChange;
    }
    this.controllerStateProps = props;

    if ('eventManager' in props && this.eventManager !== props.eventManager) {
      // EventManager has changed
      this.eventManager = props.eventManager;
      this._events = {};
      this.toggleEvents(this.events, true);
    }

    this.transitionManager.processViewStateChange(this.controllerStateProps);

    // TODO - make sure these are not reset on every setProps
    const {
      scrollZoom = true,
      dragPan = true,
      dragRotate = true,
      doubleClickZoom = true,
      touchZoom = true,
      touchRotate = false,
      keyboard = true
    } = props;

    // Register/unregister events
    const isInteractive = Boolean(this.onViewportChange || this.onViewStateChange);
    this.toggleEvents(EVENT_TYPES.WHEEL, isInteractive && scrollZoom);
    this.toggleEvents(EVENT_TYPES.PAN, isInteractive && (dragPan || dragRotate));
    this.toggleEvents(EVENT_TYPES.PINCH, isInteractive && (touchZoom || touchRotate));
    this.toggleEvents(EVENT_TYPES.DOUBLE_TAP, isInteractive && doubleClickZoom);
    this.toggleEvents(EVENT_TYPES.KEYBOARD, isInteractive && keyboard);

    // Interaction toggles
    this.scrollZoom = scrollZoom;
    this.dragPan = dragPan;
    this.dragRotate = dragRotate;
    this.doubleClickZoom = doubleClickZoom;
    this.touchZoom = touchZoom;
    this.touchRotate = touchRotate;
    this.keyboard = keyboard;
  }
  /* eslint-enable complexity, max-statements */

  toggleEvents(eventNames, enabled) {
    if (this.eventManager) {
      eventNames.forEach(eventName => {
        if (this._events[eventName] !== enabled) {
          this._events[eventName] = enabled;
          if (enabled) {
            this.eventManager.on(eventName, this.handleEvent);
          } else {
            this.eventManager.off(eventName, this.handleEvent);
          }
        }
      });
    }
  }

  // DEPRECATED

  setOptions(props) {
    return this.setProps(props);
  }

  // Private Methods

  /* Callback util */
  // formats map state and invokes callback function
  updateViewport(newControllerState, extraProps = {}, interactionState = {}) {
    const viewState = Object.assign({}, newControllerState.getViewportProps(), extraProps);

    // TODO - to restore diffing, we need to include interactionState
    const changed = this.controllerState !== newControllerState;
    // const oldViewState = this.controllerState.getViewportProps();
    // const changed = Object.keys(viewState).some(key => oldViewState[key] !== viewState[key]);

    if (changed) {
      const oldViewState = this.controllerState ? this.controllerState.getViewportProps() : null;
      if (this.onViewportChange) {
        this.onViewportChange(viewState, interactionState, oldViewState);
      }
      if (this.onViewStateChange) {
        this.onViewStateChange({viewState, interactionState, oldViewState});
      }
    }

    Object.assign(
      this._state,
      Object.assign({}, newControllerState.getInteractiveState(), interactionState)
    );
    if (this.onStateChange) {
      this.onStateChange(this._state);
    }
    // this.setState(Object.assign({}, newControllerState.getInteractiveState(), extraState));
  }

  /* Event handlers */
  // Default handler for the `panstart` event.
  _onPanStart(event) {
    const pos = this.getCenter(event);
    if (!this.isPointInBounds(pos)) {
      return false;
    }
    const newControllerState = this.controllerState.panStart({pos}).rotateStart({pos});
    return this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {isDragging: true});
  }

  // Default handler for the `panmove` event.
  _onPan(event) {
    let alternateMode = this.isFunctionKeyPressed(event) || event.rightButton;
    alternateMode = this.invertPan ? !alternateMode : alternateMode;
    return alternateMode ? this._onPanMove(event) : this._onPanRotate(event);
  }

  // Default handler for the `panend` event.
  _onPanEnd(event) {
    const newControllerState = this.controllerState.panEnd().rotateEnd();
    return this.updateViewport(newControllerState, null, {isDragging: false});
  }

  // Default handler for panning to move.
  // Called by `_onPan` when panning without function key pressed.
  _onPanMove(event) {
    if (!this.dragPan) {
      return false;
    }
    const pos = this.getCenter(event);
    const newControllerState = this.controllerState.pan({pos});
    return this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {isDragging: true});
  }

  // Default handler for panning to rotate.
  // Called by `_onPan` when panning with function key pressed.
  _onPanRotate(event) {
    if (!this.dragRotate) {
      return false;
    }

    return this.invertPan ? this._onPanRotateMap(event) : this._onPanRotateStandard(event);
  }

  // Normal pan to rotate
  _onPanRotateStandard(event) {
    const {deltaX, deltaY} = event;
    const {width, height} = this.controllerState.getViewportProps();

    const deltaScaleX = deltaX / width;
    const deltaScaleY = deltaY / height;

    const newControllerState = this.controllerState.rotate({deltaScaleX, deltaScaleY});
    return this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {isDragging: true});
  }

  _onPanRotateMap(event) {
    const {deltaX, deltaY} = event;
    const [, centerY] = this.getCenter(event);
    const startY = centerY - deltaY;
    const {width, height} = this.controllerState.getViewportProps();

    const deltaScaleX = deltaX / width;
    let deltaScaleY = 0;

    if (deltaY > 0) {
      if (Math.abs(height - startY) > PITCH_MOUSE_THRESHOLD) {
        // Move from 0 to -1 as we drag upwards
        deltaScaleY = (deltaY / (startY - height)) * PITCH_ACCEL;
      }
    } else if (deltaY < 0) {
      if (startY > PITCH_MOUSE_THRESHOLD) {
        // Move from 0 to 1 as we drag upwards
        deltaScaleY = 1 - centerY / startY;
      }
    }
    deltaScaleY = Math.min(1, Math.max(-1, deltaScaleY));

    const newControllerState = this.controllerState.rotate({deltaScaleX, deltaScaleY});
    return this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {isDragging: true});
  }

  // Default handler for the `wheel` event.
  _onWheel(event) {
    if (!this.scrollZoom) {
      return false;
    }

    const pos = this.getCenter(event);
    if (!this.isPointInBounds(pos)) {
      return false;
    }

    const {delta} = event;

    // Map wheel delta to relative scale
    let scale = 2 / (1 + Math.exp(-Math.abs(delta * ZOOM_ACCEL)));
    if (delta < 0 && scale !== 0) {
      scale = 1 / scale;
    }

    const newControllerState = this.controllerState.zoom({pos, scale});
    return this.updateViewport(newControllerState, NO_TRANSITION_PROPS);
  }

  // Default handler for the `pinchstart` event.
  _onPinchStart(event) {
    const pos = this.getCenter(event);
    if (!this.isPointInBounds(pos)) {
      return false;
    }

    const newControllerState = this.controllerState.zoomStart({pos}).rotateStart({pos});
    // hack - hammer's `rotation` field doesn't seem to produce the correct angle
    this._state.startPinchRotation = event.rotation;
    return this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {isDragging: true});
  }

  // Default handler for the `pinch` event.
  _onPinch(event) {
    if (!this.touchZoom && !this.touchRotate) {
      return false;
    }

    let newControllerState = this.controllerState;
    if (this.touchZoom) {
      const {scale} = event;
      const pos = this.getCenter(event);
      newControllerState = newControllerState.zoom({pos, scale});
    }
    if (this.touchRotate) {
      const {rotation} = event;
      const {startPinchRotation} = this._state;
      newControllerState = newControllerState.rotate({
        deltaScaleX: -(rotation - startPinchRotation) / 180
      });
    }

    return this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {isDragging: true});
  }

  // Default handler for the `pinchend` event.
  _onPinchEnd(event) {
    const newControllerState = this.controllerState.zoomEnd().rotateEnd();
    this._state.startPinchRotation = 0;
    return this.updateViewport(newControllerState, null, {isDragging: false});
  }

  // Default handler for the `doubletap` event.
  _onDoubleTap(event) {
    if (!this.doubleClickZoom) {
      return false;
    }
    const pos = this.getCenter(event);
    if (!this.isPointInBounds(pos)) {
      return false;
    }

    const isZoomOut = this.isFunctionKeyPressed(event);

    const newControllerState = this.controllerState.zoom({pos, scale: isZoomOut ? 0.5 : 2});
    return this.updateViewport(newControllerState, LINEAR_TRANSITION_PROPS);
  }

  /* eslint-disable complexity */
  // Default handler for the `keydown` event
  _onKeyDown(event) {
    if (!this.keyboard) {
      return false;
    }
    const funcKey = this.isFunctionKeyPressed(event);
    const {controllerState} = this;
    let newControllerState;

    switch (event.srcEvent.keyCode) {
      case 189: // -
        newControllerState = funcKey
          ? controllerState.zoomOut().zoomOut()
          : controllerState.zoomOut();
        break;
      case 187: // +
        newControllerState = funcKey ? controllerState.zoomIn().zoomIn() : controllerState.zoomIn();
        break;
      case 37: // left
        newControllerState = funcKey ? controllerState.rotateLeft() : controllerState.moveLeft();
        break;
      case 39: // right
        newControllerState = funcKey ? controllerState.rotateRight() : controllerState.moveRight();
        break;
      case 38: // up
        newControllerState = funcKey ? controllerState.rotateUp() : controllerState.moveUp();
        break;
      case 40: // down
        newControllerState = funcKey ? controllerState.rotateDown() : controllerState.moveDown();
        break;
      default:
        return false;
    }
    return this.updateViewport(newControllerState, LINEAR_TRANSITION_PROPS);
  }
  /* eslint-enable complexity */
}

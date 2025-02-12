import {
  addClassName,
  clearDimensions,
  decrementMoveCbCount,
  getDimensions,
  getGeometry,
  incrementMoveCbCount,
  registerTransitionListener,
  removeClassName,
  setDimensions,
  setDisplay,
  resetDisplay,
  setTransform,
  clearTransform
} from './utils';
import { queueAnimation, AnimationPhase } from './animationCoordinator';
import { isNullOrUndef, isNull } from 'inferno-shared';

// Show debug output and debugging markers during developmen of move animations
const _DBG_MVE_ = false && process.env.NODE_ENV !== 'production';

export type AnimationClass = {
  active: string;
  end: string;
  start: string;
};

function getAnimationClass(animationProp: AnimationClass | string | undefined | null, prefix: string): AnimationClass {
  let animCls: AnimationClass;

  if (!isNullOrUndef(animationProp) && typeof animationProp === 'object') {
    animCls = animationProp;
  } else {
    const animationName = animationProp || 'inferno-animation';
    const placeholder = animationName + prefix;
    animCls = {
      active: placeholder + '-active',
      end: placeholder + '-end',
      start: placeholder
    };
  }

  return animCls;
}

export function componentDidAppear(dom: HTMLElement, props) {
  // Get dimensions and unpack class names
  const cls = getAnimationClass(props.animation, '-enter');

  // Moved measuring to pre_initialize. It causes a reflow for each component beacuse of the setDisplay of previous component.
  const dimensions = {};
  const display = setDisplay(dom, 'none');
  queueAnimation((phase) => _didAppear(phase, dom, cls, dimensions, display));
}

function _getDidAppearTransitionCallback(dom, cls) {
  return () => {
    // 5. Remove the element
    clearDimensions(dom);
    removeClassName(dom, cls.active + ' ' + cls.end);
    // 6. Call callback to allow stuff to happen
    // Not currently used but this is where one could
    // add a call to something like this.didAppearDone
  };
}

function _didAppear(phase: AnimationPhase, dom: HTMLElement, cls: AnimationClass, dimensions, display: string) {
  switch (phase) {
    case AnimationPhase.INITIALIZE:
      // Needs to be done in a single pass to avoid reflows
      // We set display: none whilst waiting for an animation frame to avoid flicker
      resetDisplay(dom, display);
      return;
    case AnimationPhase.MEASURE:
      getDimensions(dom);
      return;
    case AnimationPhase.SET_START_STATE:
      // 1. Set start of animation
      addClassName(dom, cls.start);
      return;
    case AnimationPhase.ACTIVATE_TRANSITIONS:
      // 2. Activate transition (after a reflow)
      addClassName(dom, cls.active);
      return;
    case AnimationPhase.REGISTER_LISTENERS:
      // 3. Set an animation listener, code at end
      // Needs to be done after activating so timeout is calculated correctly
      registerTransitionListener(
        // *** Cleanup is broken out as micro optimisation ***
        [dom],
        _getDidAppearTransitionCallback(dom, cls)
      );
    case AnimationPhase.ACTIVATE_ANIMATION:
      // 4. Activate target state (called async via requestAnimationFrame)
      setDimensions(dom, dimensions.width, dimensions.height);
      removeClassName(dom, cls.start);
      addClassName(dom, cls.end);
      return;
  }
}

export function componentWillDisappear(dom: HTMLElement, props, callback: Function) {
  // Get dimensions and unpack class names
  const cls = getAnimationClass(props.animation, '-leave');
  const dimensions = getDimensions(dom);
  queueAnimation((phase) => _willDisappear(phase, dom, callback, cls, dimensions));
}

function _willDisappear(phase: AnimationPhase, dom: HTMLElement, callback: Function, cls: AnimationClass, dimensions) {
  switch (phase) {
    case AnimationPhase.MEASURE:
      // 1. Get dimensions and set animation start state
      setDimensions(dom, dimensions.width, dimensions.height);
      addClassName(dom, cls.start);
      return;
    case AnimationPhase.ACTIVATE_TRANSITIONS:
      // 2. Activate transition (after a reflow)
      addClassName(dom, cls.active);
      return;
    case AnimationPhase.REGISTER_LISTENERS:
      // 3. Set an animation listener, code at end
      // Needs to be done after activating so timeout is calculated correctly
      registerTransitionListener(
        // Unlike _didAppear, no cleanup needed since node is removed.
        // Just passing the componentWillDisappear callback so Inferno can
        // remove the nodes.
        [dom],
        callback
      );
    case AnimationPhase.ACTIVATE_ANIMATION:
      // 4. Activate target state (called async via requestAnimationFrame)
      addClassName(dom, cls.end);
      removeClassName(dom, cls.start);
      clearDimensions(dom);
  }
}

export function componentWillMove(parentVNode, parent: HTMLElement, dom: HTMLElement, props: any) {
  // tslint:disable-next-line
  if (_DBG_MVE_) console.log('Animating move', dom);

  // Measure all siblings of moved node once before any mutations are done
  let els;
  if (!parentVNode.$MV) {
    parentVNode.$MV = true;
    els = [];
    let tmpEl = parent.firstChild as HTMLElement;
    while (!isNull(tmpEl)) {
      els.push({
        dx: 0,
        dy: 0,
        geometry: getGeometry(tmpEl),
        moved: false,
        node: tmpEl
      });
      tmpEl = tmpEl.nextSibling as HTMLElement;
    }
  }

  // Get animation class names
  const cls = getAnimationClass(props.animation, '-move');

  const animState = {
    els,
    isMaster: !isNullOrUndef(els),
    parentVNode
  };
  queueAnimation((phase) => _willMove(phase, cls, animState));
}

function _willMove(phase: AnimationPhase, cls: AnimationClass, animState) {
  const { els, isMaster, parentVNode } = animState;

  switch (phase) {
    case AnimationPhase.MEASURE:
      // If we are responsible for triggering measures, we check all the target positions
      if (isMaster) {
        for (let i = 0; i < els.length; i++) {
          const tmpItem = els[i];
          // Make sure we can measure target properly
          removeClassName(tmpItem.node, cls.active);
          // Measure
          const geometry = getGeometry(tmpItem.node);
          const deltaX = tmpItem.geometry.x - geometry.x;
          const deltaY = tmpItem.geometry.y - geometry.y;
          if (deltaX !== 0 || deltaY !== 0) {
            tmpItem.moved = true;
            tmpItem.dx = deltaX;
            tmpItem.dy = deltaY;
          }
          // TODO: Check dimensions
        }
      }
      return;
    case AnimationPhase.SET_START_STATE:
      /**
       * At this state we have measure the size of the moving node
       * both at source and target so now we let the source placeholder
       * fill the source space and move the node to start position
       * by transform
       */
      if (isMaster) {
        for (let i = 0; i < els.length; i++) {
          const tmpItem = els[i];
          if (tmpItem.moved) {
            setTransform(tmpItem.node, tmpItem.dx, tmpItem.dy);
          }
          // TODO: Set dimensions
        }
      }
      return;
    case AnimationPhase.ACTIVATE_TRANSITIONS:
      // A reflow is triggered prior to this step
      if (isMaster) {
        for (let i = 0; i < els.length; i++) {
          const tmpItem = els[i];
          if (tmpItem.moved) {
            addClassName(tmpItem.node, cls.active);
          }
        }
      }
      return;
    case AnimationPhase.REGISTER_LISTENERS:
      if (isMaster) {
        for (let i = 0; i < els.length; i++) {
          const tmpItem = els[i];
          if (tmpItem.moved) {
            registerTransitionListener(
              // How to know if this is a compound move?
              [tmpItem.node],
              _getWillMoveTransitionCallback(tmpItem.node, cls)
            );
            // Keep track of how many callbacks will be fired
            incrementMoveCbCount(tmpItem.node);
          }
        }
      }
      return;
    case AnimationPhase.ACTIVATE_ANIMATION:
      // 10. Apply target geometry of node to target
      if (isMaster) {
        for (let i = 0; i < els.length; i++) {
          const tmpItem = els[i];
          if (tmpItem.moved) {
            setTransform(tmpItem.node, 0, 0);
          }
        }
      }
      // TODO: Set dimensions
      if (parentVNode.$MV) parentVNode.$MV = false;
  }
}

function _getWillMoveTransitionCallback(dom: HTMLElement, cls: AnimationClass) {
  return () => {
    // Only remove these if the translate has completed
    const cbCount = decrementMoveCbCount(dom);
    if (cbCount === 0) {
      clearDimensions(dom);
      clearTransform(dom);
      removeClassName(dom, cls.active);
    }
  };
}

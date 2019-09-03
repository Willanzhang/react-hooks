/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root direcreatey of this source tree.
 *
 * @flow
 */

import type {ReactContext} from 'shared/ReactTypes';
import type {Fiber} from './ReactFiber';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {HookEffectTag} from './ReactHookEffectTags';

import {NoWork} from './ReactFiberExpirationTime';
import {enableHooks} from 'shared/ReactFeatureFlags';
import {readContext} from './ReactFiberNewContext';
import {
  Update as UpdateEffect,
  Passive as PassiveEffect,
} from 'shared/ReactSideEffectTags';
import {
  NoEffect as NoHookEffect,
  UnmountMutation,
  MountLayout,
  UnmountPassive,
  MountPassive,
} from './ReactHookEffectTags';
import {
  scheduleWork,
  computeExpirationForFiber,
  flushPassiveEffects,
  requestCurrentTime,
} from './ReactFiberScheduler';

import invariant from 'shared/invariant';
import areHookInputsEqual from 'shared/areHookInputsEqual';

type Update<A> = {
  expirationTime: ExpirationTime,
  action: A,
  next: Update<A> | null,
};

type UpdateQueue<A> = {
  last: Update<A> | null,
  dispatch: any,
};

export type Hook = {
  memoizedState: any,

  baseState: any,
  baseUpdate: Update<any> | null,
  queue: UpdateQueue<any> | null,

  next: Hook | null,
};

type Effect = {
  tag: HookEffectTag,
  create: () => mixed,
  destroy: (() => mixed) | null,
  inputs: Array<mixed>,
  next: Effect,
};

export type FunctionComponentUpdateQueue = {
  lastEffect: Effect | null,
};

type BasicStateAction<S> = (S => S) | S;

type Dispatch<A> = A => void;

// These are set right before calling the component.
let renderExpirationTime: ExpirationTime = NoWork;
// The work-in-progress fiber. I've named it differently to distinguish it from
// the work-in-progress hook.
let currentlyRenderingFiber: Fiber | null = null;

// Hooks are stored as a linked list on the fiber's memoizedState field. The
// current hook list is the list that belongs to the current fiber. The
// work-in-progress hook list is a new list that will be added to the
// work-in-progress fiber.
let firstCurrentHook: Hook | null = null;
let currentHook: Hook | null = null;
let firstWorkInProgressHook: Hook | null = null;
let workInProgressHook: Hook | null = null;

let remainingExpirationTime: ExpirationTime = NoWork;
let componentUpdateQueue: FunctionComponentUpdateQueue | null = null;

// Updates scheduled during render will trigger an immediate re-render at the
// end of the current pass. We can't store these updates on the normal queue,
// because if the work is aborted, they should be discarded. Because this is
// a relatively rare case, we also don't want to add an additional field to
// either the hook or queue object types. So we store them in a lazily create
// map of queue -> render-phase updates, which are discarded once the component
// completes without re-rendering.

// Whether the work-in-progress hook is a re-rendered hook
let isReRender: boolean = false;
// Whether an update was scheduled during the currently executing render pass.
let didScheduleRenderPhaseUpdate: boolean = false;
// Lazily created map of render-phase updates
let renderPhaseUpdates: Map<UpdateQueue<any>, Update<any>> | null = null;
// Counter to prevent infinite loops.
let numberOfReRenders: number = 0;
const RE_RENDER_LIMIT = 25;

function resolveCurrentlyRenderingFiber(): Fiber {
  invariant(
    currentlyRenderingFiber !== null,
    'Hooks can only be called inside the body of a function component.',
  );
  return currentlyRenderingFiber;
}

// 初始化这个模块的共工变量
export function prepareToUseHooks(
  current: Fiber | null,
  workInProgress: Fiber,
  nextRenderExpirationTime: ExpirationTime,
): void {
  if (!enableHooks) {
    return;
  }
  renderExpirationTime = nextRenderExpirationTime;
  // currentlyRenderingFiber 对应当前正在执行的 functionComponent 的 fiber对象
  currentlyRenderingFiber = workInProgress;
  // 判断是不是 第一次渲染  
  // 在classComponent 中 memoizedState是用来记录这个component对应的是 上次 state 的属性
  // 在 functionComponent 在我们使用 Hooks 的时候 他是用来记录 在这个 functionComponent 中调用的 第一个 Hooks api对应的对象（也是一个链表结构） 
  // 按顺序存储每一次 Hooks api 调用的 过程中 这个 API 对应的对象
  firstCurrentHook = current !== null ? current.memoizedState : null;

  // The following should have already been reset
  // currentHook = null;
  // workInProgressHook = null;

  // remainingExpirationTime = NoWork;
  // componentUpdateQueue = null;

  // isReRender = false;
  // didScheduleRenderPhaseUpdate = false;
  // renderPhaseUpdates = null;
  // numberOfReRenders = 0;
}

export function finishHooks(
  Component: any,
  props: any,
  children: any,
  refOrContext: any,
): any {
  if (!enableHooks) {
    return children;
  }

  // This must be called after every function component to prevent hooks from
  // being used in classes.
  // 执行functionComponent 的过程中 还没有触发事件的收就去调用 一个setName  这就导致在渲染过程中产生了 update
  // didScheduleRenderPhaseUpdate 就是判断是否在渲染过程中 产生了update 它会在这个节点把update 处理掉， 不会留到下一次更新
  while (didScheduleRenderPhaseUpdate) {
    // Updates were scheduled during the render phase. They are stored in
    // the `renderPhaseUpdates` map. Call the component again, reusing the
    // work-in-progress hooks and applying the additional updates on top. Keep
    // restarting until no more updates are scheduled.
    didScheduleRenderPhaseUpdate = false;
    // 记录一个rerender的数值， 避免无限循环更新   
    // 要避免直接在 functionComponent 直接调用更新
    numberOfReRenders += 1;

    // Start over from the beginning of the list
    currentHook = null;
    workInProgressHook = null;
    componentUpdateQueue = null;

    children = Component(props, refOrContext);
  }
  renderPhaseUpdates = null;
  numberOfReRenders = 0;

  const renderedWork: Fiber = (currentlyRenderingFiber: any);

  // 对应 这个functionComponent 中的每一个Hooks 都有个 WorkInProgressHook 对象
  // 每一个 Hooks 会记录 各自的一些对象属性
  renderedWork.memoizedState = firstWorkInProgressHook;

  // 待续
  renderedWork.expirationTime = remainingExpirationTime;
  renderedWork.updateQueue = (componentUpdateQueue: any);

  // 下面是一些状态的重置
  const didRenderTooFewHooks =
    currentHook !== null && currentHook.next !== null;

  renderExpirationTime = NoWork;
  currentlyRenderingFiber = null;

  firstCurrentHook = null;
  currentHook = null;
  firstWorkInProgressHook = null;
  workInProgressHook = null;

  remainingExpirationTime = NoWork;
  componentUpdateQueue = null;

  // Always set during createWorkInProgress
  // isReRender = false;

  // These were reset above
  // didScheduleRenderPhaseUpdate = false;
  // renderPhaseUpdates = null;
  // numberOfReRenders = 0;

  invariant(
    !didRenderTooFewHooks,
    'Rendered fewer hooks than expected. This may be caused by an accidental ' +
      'early return statement.',
  );

  return children;
}

export function resetHooks(): void {
  if (!enableHooks) {
    return;
  }

  // This is called instead of `finishHooks` if the component throws. It's also
  // called inside mountIndeterminateComponent if we determine the component
  // is a module-style component.
  renderExpirationTime = NoWork;
  currentlyRenderingFiber = null;

  firstCurrentHook = null;
  currentHook = null;
  firstWorkInProgressHook = null;
  workInProgressHook = null;

  remainingExpirationTime = NoWork;
  componentUpdateQueue = null;

  // Always set during createWorkInProgress
  // isReRender = false;

  didScheduleRenderPhaseUpdate = false;
  renderPhaseUpdates = null;
  numberOfReRenders = 0;
}

function createHook(): Hook {
  return {
    memoizedState: null,

    baseState: null,
    queue: null,
    baseUpdate: null,

    next: null,
  };
}

function cloneHook(hook: Hook): Hook {
  return {
    memoizedState: hook.memoizedState,

    baseState: hook.baseState,
    queue: hook.queue,
    baseUpdate: hook.baseUpdate,

    next: null,
  };
}

function createWorkInProgressHook(): Hook {
  // 第一次(第一个hook)进来是 workInProgressHook = null  
  // 因为 上一次 hook functionConponent 的调用 会把全局变量 workInProgressHook 置空
  // 所以 执行 任意一个hook functionConponent 调用的 !第一个! hook api  workInProgressHook 肯定是等于null
  if (workInProgressHook === null) {
    // This is the first hook in the list
    if (firstWorkInProgressHook === null) {
      // 此hookFunctionComponent 第一次调用 hook API 都进入这个判断
      isReRender = false;
      currentHook = firstCurrentHook;
      if (currentHook === null) {
        // This is a newly mounted hook
        // 当前 hook functionConponent 第一调用 hook api  因为workInProgressHook 链为空，这里会新创建一个 hook 对象
        workInProgressHook = createHook();
      } else {

        // Clone the current hook.
        workInProgressHook = cloneHook(currentHook);
      }
      firstWorkInProgressHook = workInProgressHook;
    } else {
      // 假如 是渲染过程中 产生的更新 会重现渲染
      // There's already a work-in-progress. Reuse it.
      isReRender = true;
      currentHook = firstCurrentHook;
      workInProgressHook = firstWorkInProgressHook;
    }
  } else {
    if (workInProgressHook.next === null) {
      isReRender = false;
      let hook;
      if (currentHook === null) {
        // This is a newly mounted hook
        hook = createHook();
      } else {
        currentHook = currentHook.next;
        if (currentHook === null) {
          // This is a newly mounted hook
          hook = createHook();
        } else {
          // Clone the current hook.
          hook = cloneHook(currentHook);
        }
      }
      // Append to the end of the list
      workInProgressHook = workInProgressHook.next = hook;
    } else {
      // There's already a work-in-progress. Reuse it.
      isReRender = true;
      workInProgressHook = workInProgressHook.next;
      currentHook = currentHook !== null ? currentHook.next : null;
    }
  }
  return workInProgressHook;
}

function createFunctionComponentUpdateQueue(): FunctionComponentUpdateQueue {
  return {
    lastEffect: null,
  };
}

function basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
  return typeof action === 'function' ? action(state) : action;
}

export function useContext<T>(
  context: ReactContext<T>,
  observedBits: void | number | boolean,
): T {
  // Ensure we're in a function component (class components support only the
  // .unstable_read() form)
  resolveCurrentlyRenderingFiber();
  // readContext 是和 classsComponent 的 readContext 相同
  return readContext(context, observedBits);
}

export function useState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  // 这里知道 useState 是 关于 useReducer的封装
  return useReducer(
    basicStateReducer,
    // useReducer has a special case to support lazy useState initializers
    (initialState: any),
  );
}

export function useReducer<S, A>(
  reducer: (S, A) => S,
  initialState: S,
  initialAction: A | void | null,
): [S, Dispatch<A>] {
  currentlyRenderingFiber = resolveCurrentlyRenderingFiber();
  // 每执行一个 hook 方法 都会创建一个 hook 对象 这里处理 workInProgressHook 链
  // 可以把 workInProgressHook 链看成 是更小粒度的 fiber
  // fiber 的更新是在 updateQueue 上  是针对fiber 
  // workInProgressHook 的更新 是针对 hook 使用对象上   在 workInProgressHook 有queue 链表 代表更新列表
  workInProgressHook = createWorkInProgressHook();
  // hook functionComponent 执行 第一次 hook api 的时候 queue 是 null
  let queue: UpdateQueue<A> | null = (workInProgressHook.queue: any);
  if (queue !== null) {
    // Already have a queue, so this is an update.
    // isReRender 的 赋值 可以看 createWorkInProgressHook 看 isReRender = true 情况
    if (isReRender) {
      // 是否是在 render 的过程中创建的 update
      // This is a re-render. Apply the new render phase updates to the previous
      // work-in-progress hook.
      const dispatch: Dispatch<A> = (queue.dispatch: any);
      if (renderPhaseUpdates !== null) {
        // Render phase updates are stored in a map of queue -> linked list
        // renderPhaseUpdates 也是在 dispatchAction 的时候进行设置
        const firstRenderPhaseUpdate = renderPhaseUpdates.get(queue);
        if (firstRenderPhaseUpdate !== undefined) {
          // isReRender = true  并且 renderPhaseUpdates = true  在渲染过程产生 update
          // 这里没有expirationTime 比较 说明 要直接进行更新的 所有的update会立马被执行

          renderPhaseUpdates.delete(queue);
          let newState = workInProgressHook.memoizedState;
          let update = firstRenderPhaseUpdate;
          // do while 循环 处理 update 计算 newState
          do {
            // Process this render phase update. We don't have to check the
            // priority because it will always be the same as the current
            // render's.
            const action = update.action;
            newState = reducer(newState, action);
            update = update.next;
          } while (update !== null);

          workInProgressHook.memoizedState = newState;

          // Don't persist the state accumlated from the render phase updates to
          // the base state unless the queue is empty.
          // TODO: Not sure if this is the desired semantics, but it's what we
          // do for gDSFP. I can't remember why.
          if (workInProgressHook.baseUpdate === queue.last) {
            workInProgressHook.baseState = newState;
          }

          return [newState, dispatch];
        }
      }
      return [workInProgressHook.memoizedState, dispatch];
    }

    // The last update in the entire queue
    const last = queue.last;
    // The last update that is part of the base state.
    // 第二次api 调用进来 baseUpdate = null
    const baseUpdate = workInProgressHook.baseUpdate;

    // Find the first unprocessed update.
    let first;
    if (baseUpdate !== null) {
      if (last !== null) {
        // For the first update, the queue is a circular linked list where
        // `queue.last.next = queue.first`. Once the first update commits, and
        // the `baseUpdate` is no longer empty, we can unravel the list.
        last.next = null;
      }
      first = baseUpdate.next;
    } else {
      first = last !== null ? last.next : null;
    }
    if (first !== null) {
      let newState = workInProgressHook.baseState;
      let newBaseState = null;
      let newBaseUpdate = null;
      let prevUpdate = baseUpdate;
      let update = first;
      let didSkip = false;
      do {
        const updateExpirationTime = update.expirationTime;
        // 16.8 的版本 关于expirationTime 的 计算和 优先级的比较相比于 16.6 版本 有所不同
        // 16.8 版本是 expirationTime 越 小 优先级越低  和 16.6 完全相反(expirationTime 越 大 优先级越低)
        if (updateExpirationTime < renderExpirationTime) {
          // 这个 updateExpirationTime 优先级 低的话 要跳过
          // Priority is insufficient. Skip this update. If this is the first
          // skipped update, the previous update/state is the new base
          // update/state.
          if (!didSkip) {
            didSkip = true;
            // 记录的是 第一个被跳过的更新的前一个更新的状态
            newBaseUpdate = prevUpdate;
            newBaseState = newState;
          }
          // Update the remaining priority in the queue.
          // remaining 剩下
          if (updateExpirationTime > remainingExpirationTime) {
            remainingExpirationTime = updateExpirationTime;
          }
        } else {
          // Process this update.
          // 需要被更新
          const action = update.action;
          // 会计算出一个新的state
          // action 是什么？ action 是 string
          newState = reducer(newState, action);
        }
        prevUpdate = update;
        update = update.next;
      } while (update !== null && update !== first);
      // 上面这个 do while 循环就是操作完 queue中的整个链表

      if (!didSkip) {
        newBaseUpdate = prevUpdate;
        newBaseState = newState;
      }

      // 设置 新的 state
      workInProgressHook.memoizedState = newState;
      workInProgressHook.baseUpdate = newBaseUpdate;
      workInProgressHook.baseState = newBaseState;
    }

    const dispatch: Dispatch<A> = (queue.dispatch: any);
    // return 一个 更新过后的 state
    return [workInProgressHook.memoizedState, dispatch];
  }

  // There's no existing queue, so this is the initial render.
  // 初始化 第一次调用hook api的时候会走这里
  // 后面的调用都不会走下面流程
  if (reducer === basicStateReducer) {
    // 为 useState 执行
    // Special case for `useState`.
    if (typeof initialState === 'function') {
      initialState = initialState();
    }
  } else if (initialAction !== undefined && initialAction !== null) {
    initialState = reducer(initialState, initialAction);
  }
  workInProgressHook.memoizedState = workInProgressHook.baseState = initialState;
  queue = workInProgressHook.queue = {
    last: null,
    dispatch: null,
  };
  // dispatch 是个重点
  const dispatch: Dispatch<A> = (queue.dispatch = (dispatchAction.bind(
    null,
    currentlyRenderingFiber,
    queue,
  ): any));
  // 这里就是 使用 useState 返回的数组
  return [workInProgressHook.memoizedState, dispatch];
}

// 其实就是在componentUpdateQueue 构建 effect 的循环链表
function pushEffect(tag, create, destroy, inputs) {
  const effect: Effect = {
    tag,
    create,
    destroy,
    inputs,
    // Circular
    next: (null: any),
  };
  // 每一个 fiber对象 对应一个 componentUpdateQueue
  // 所有的 useEffect 的结果（effect） 都会保存在 componentUpdateQueue上面
  if (componentUpdateQueue === null) {
    // createFunctionComponentUpdateQueue()  return {lastEffect: null};
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    // 和useState 的 queue 一样是 循环链表
    componentUpdateQueue.lastEffect = effect.next = effect;
  } else {
    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect;
    } else {
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }
  }
  return effect;
}

export function useRef<T>(initialValue: T): {current: T} {
  currentlyRenderingFiber = resolveCurrentlyRenderingFiber();
  workInProgressHook = createWorkInProgressHook();
  let ref;

  if (workInProgressHook.memoizedState === null) {
    // 只是 赋值了一个具有current属性的对象 我们可以更新这个属性上的东西
    ref = {current: initialValue};
    if (__DEV__) {
      Object.seal(ref);
    }
    // 会记录在 memoizedState 上
    workInProgressHook.memoizedState = ref;
  } else {
    ref = workInProgressHook.memoizedState;
  }
  return ref;
}

export function useLayoutEffect(
  create: () => mixed,
  inputs: Array<mixed> | void | null,
): void {
  useEffectImpl(UpdateEffect, UnmountMutation | MountLayout, create, inputs);
}

export function useEffect(
  create: () => mixed,
  inputs: Array<mixed> | void | null,
): void {
  // UpdateEffect 其实就是 sideEffectTags中的Update
  // Passive: 被动
  useEffectImpl(
    UpdateEffect | PassiveEffect,
    UnmountPassive | MountPassive,
    create,
    inputs,
  );
}

function useEffectImpl(fiberEffectTag, hookEffectTag, create, inputs): void {
  // 获取 当前这个 fiber
  currentlyRenderingFiber = resolveCurrentlyRenderingFiber();
  // 创建 hook对象
  workInProgressHook = createWorkInProgressHook();

  let nextInputs = inputs !== undefined && inputs !== null ? inputs : [create];
  let destroy = null;
  if (currentHook !== null) {
    // currentHook !== null 说明不是第一次渲染
    const prevEffect = currentHook.memoizedState;
    destroy = prevEffect.destroy;
    // 不是第一次渲染 就会进行对比，nextInputs 和上一次的 更新完成后的状态
    // areHookInputsEqual 就是通过 Object.is 对比 两个数组中的值， 是否相等
    if (areHookInputsEqual(nextInputs, prevEffect.inputs)) {

      // 都相同的 话  NoHookEffect = 0
      // 其实就是在componentUpdateQueue 构建 effect 的循环链表
      pushEffect(NoHookEffect, create, destroy, nextInputs);
      return;
    }
  }

  // 不相同 或者 是第一次渲染
  currentlyRenderingFiber.effectTag |= fiberEffectTag;

  // hookEffectTag
  workInProgressHook.memoizedState = pushEffect(
    hookEffectTag,
    create,
    destroy,
    nextInputs,
  );
}

export function useImperativeMethods<T>(
  ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  inputs: Array<mixed> | void | null,
): void {
  // TODO: If inputs are provided, should we skip comparing the ref itself?
  // 对比 inputs
  const nextInputs =
    inputs !== null && inputs !== undefined
      ? inputs.concat([ref])
      : [ref, create];

  // TODO: I've implemented this on top of useEffect because it's almost the
  // same thing, and it would require an equal amount of code. It doesn't seem
  // like a common enough use case to justify the additional size.
  // 调用 useLayoutEffect 
  useLayoutEffect(() => {
    // 在 create 的时候 调用 这个 ref
    if (typeof ref === 'function') {
      const refCallback = ref;
      const inst = create();
      // ref 执行 create 返回的内容
      refCallback(inst);
      return () => refCallback(null);
    } else if (ref !== null && ref !== undefined) {
      const refObject = ref;
      const inst = create();
      // 如果是有currents 属性的对象  就把 current 更新成为 用这个 方法 返回的inst
      refObject.current = inst;
      return () => {
        refObject.current = null;
      };
    }
  }, nextInputs);
}

export function useCallback<T>(
  callback: T,
  inputs: Array<mixed> | void | null,
): T {
  currentlyRenderingFiber = resolveCurrentlyRenderingFiber();
  workInProgressHook = createWorkInProgressHook();

  const nextInputs =
    inputs !== undefined && inputs !== null ? inputs : [callback];

  const prevState = workInProgressHook.memoizedState;
  if (prevState !== null) {
    const prevInputs = prevState[1];
    // 也是对比 inputs
    if (areHookInputsEqual(nextInputs, prevInputs)) {
      // 若果对比一样  就直接返回 memoizedState
      return prevState[0];
    }
  }
  // 若果不同 就 更新 memoizedState
  workInProgressHook.memoizedState = [callback, nextInputs];
  // 并且返回新的 callback
  return callback;
}

export function useMemo<T>(
  nextCreate: () => T,
  inputs: Array<mixed> | void | null,
): T {
  currentlyRenderingFiber = resolveCurrentlyRenderingFiber();
  workInProgressHook = createWorkInProgressHook();

  const nextInputs =
    inputs !== undefined && inputs !== null ? inputs : [nextCreate];

  const prevState = workInProgressHook.memoizedState;
  if (prevState !== null) {
    const prevInputs = prevState[1];
    if (areHookInputsEqual(nextInputs, prevInputs)) {
      return prevState[0];
    }
  }

  // 不同就 执行nextCreate() 作为新的结果  作为返回内容    
  // 与useCallback的区别是 
  // useCallback是不执行 而是将函数作为值存储在memoizedState 中
  const nextValue = nextCreate();
  workInProgressHook.memoizedState = [nextValue, nextInputs];
  return nextValue;
}

// 派发行为 创建 dispatchAction 并且放到 hook对象 queue上
function dispatchAction<A>(fiber: Fiber, queue: UpdateQueue<A>, action: A) {
  invariant(
    numberOfReRenders < RE_RENDER_LIMIT,
    'Too many re-renders. React limits the number of renders to prevent ' +
      'an infinite loop.',
  );

  const alternate = fiber.alternate;
  if (
    fiber === currentlyRenderingFiber ||
    (alternate !== null && alternate === currentlyRenderingFiber)
  ) {
    // 假如是更新阶段产生了 update
    // This is a render phase update. Stash it in a lazily-created map of
    // queue -> linked list of updates. After this render pass, we'll restart
    // and apply the stashed updates on top of the work-in-progress hook.
    // 渲染过程中 产生更新 这里又会 影响 finishHook 的执行 会循环 判断didScheduleRenderPhaseUpdate 调用 functionComponent 
    // 然后在 createWorkInProgressHook 在进行特殊的判断
    didScheduleRenderPhaseUpdate = true;
    const update: Update<A> = {
      expirationTime: renderExpirationTime,
      action,
      next: null,
    };
    if (renderPhaseUpdates === null) {
      renderPhaseUpdates = new Map();
    }
    const firstRenderPhaseUpdate = renderPhaseUpdates.get(queue);
    if (firstRenderPhaseUpdate === undefined) {
      renderPhaseUpdates.set(queue, update);
    } else {
      // Append the update to the end of the list.
      let lastRenderPhaseUpdate = firstRenderPhaseUpdate;
      // 处理链表
      while (lastRenderPhaseUpdate.next !== null) {
        lastRenderPhaseUpdate = lastRenderPhaseUpdate.next;
      }
      lastRenderPhaseUpdate.next = update;
    }
  } else {
    const currentTime = requestCurrentTime();
    const expirationTime = computeExpirationForFiber(currentTime, fiber);
    const update: Update<A> = {
      expirationTime,
      action,
      next: null,
    };
    flushPassiveEffects();
    // Append the update to the end of the list.
    // last 就是 对应的 workInProgressHook 对象 上的 queue 的 last 属性  
    // last 所有的 update中最后的那一个
    const last = queue.last;
    // 这个 if 的 判断 是为了在 queue 中形成一个循环的链表
    if (last === null) {
      // This is the first update. Create a circular list.
      update.next = update;
    } else {
      // 通过 last.next 指定 first
      const first = last.next;
      if (first !== null) {
        // Still circular.
        update.next = first;
      }
      last.next = update;
    }
    queue.last = update;
    // 也会 发起一次 scheduleWork  和 setState 一样的 
    // 进入一个更新的流程 调用updateFunctionComponent
    scheduleWork(fiber, expirationTime);
  }
}

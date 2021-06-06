/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,
    expOrFn: string | Function,//表达式或函数，用于收集vm属性的dep
    cb: Function,// run 运行回调
    options?: ?Object,// 观察配置
    isRenderWatcher?: boolean //设置当前watcher是不是VM主渲观察实例 
  ) {
    this.vm = vm
    if (isRenderWatcher) {
      vm._watcher = this
    }
    vm._watchers.push(this);//添加到当前vm中
    // options
    if (options) {
      this.deep = !!options.deep //深度观察
      this.user = !!options.user;// 捕捉异常处理
      this.lazy = !!options.lazy;//是否延迟收集和更新,计算属性
      this.sync = !!options.sync;//同步执行
      this.before = options.before;//watcher run运行前，触 发
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    this.cb = cb;//观察回调
    this.id = ++uid // uid for batching 增量ID，保证创建顺序
    this.active = true;//当前watcher是否可用
    this.dirty = this.lazy // for lazy watchers 表示是否可执行脏计算
    this.deps = [];//旧的依赖对象
    this.newDeps = [];//最新所有依赖对象
    this.depIds = new Set();
    this.newDepIds = new Set();
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn);//把表达式转换为函数
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * 计算getter，并重新收集依赖项。
   */
  get () {
    pushTarget(this);//设置当前观察对象为依赖收集目标
    let value
    const vm = this.vm
    try {
      value = this.getter.call(vm, vm);//执行渲染函数或表达式，触发defineProperty
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        traverse(value)//如果允许深度收集，就递归执行对象所有
      }
      popTarget();//弹出当前watcher对象
      this.cleanupDeps();//清理旧的依赖关系
    }
    return value
  }

  /**
   * 在执行get时，会收集vm代理属性的dep
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id;
    //如果依赖对象不存在
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id);//添加依赖对象的ID，用于快速检查
      this.newDeps.push(dep);//添加依赖对象
      // 如果当前watcher对象未添加到dep对象中
      // 保证watcher只会添加到dep一次
      if (!this.depIds.has(id)) {
        //如果 setter发生值的变化，就通当前watcher.update
        dep.addSub(this)//添加当前watcher到dep订阅数组中
      }
    }
  }

  /**
   * 清理依赖性集合。
   * 执行完get收集后，
   * 把newDepIds，newDeps数据复制到depIds，deps中，
   * 清空newDeps和newDepIds,
   */
  cleanupDeps () {
    let i = this.deps.length
    // 如果旧的依赖数组不为空。
    //并且不存在于新的依赖列表中，就删除依赖对象对当前watcher的订阅
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp;//避免重新创建Set，消耗性能
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp; //避免重新创建array，消耗性能
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    //延迟手动更新，可用于大批量修改属性时，等待全部修改完后，手动更新,当计算属性内部依赖的data属性发生变化时
    if (this.lazy) {
      this.dirty = true;//用于计算属性手动执行，evaluate
    } else if (this.sync) {
      this.run();//同步执行
    } else {
      //添加到下个微任务队列中执行，这样的话可以让当前同步执行的属性更新操作执行完后，再去通知观察回调
      // 性能处理
      queueWatcher(this)
    }
  }
  /**
  * Scheduler作业界面。
  *将由调度程序调用。
  */
  run () {
    //如果激活中，是否可用
    if (this.active) {
      const value = this.get();//获取观察的计算结果
      if (
        value !== this.value ||
        //深度观察者和对象/阵列上的观察者甚至应触发
         //当值相同时，因为值可能
         //已经变异。
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        if (this.user) {
          try {
            this.cb.call(this.vm, value, oldValue)
          } catch (e) {
            handleError(e, this.vm, `callback for watcher "${this.expression}"`)
          }
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
  *评估观察者的价值。
  *这仅适用于懒惰的观察者。
  */
  evaluate () {
    this.value = this.get()
    this.dirty = false;//表示已执行过
  }

  /**
   *取决于此观察者收集的所有部门。
   把当前watcher对象下，所有依赖对象，重新添加到某个目标watcher中
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * 从所有依赖项的订户列表中删除自身。
   */
  teardown () {
    if (this.active) {
        //从vm的观察者列表中删除self
       //这是一个比较昂贵的操作，因此我们跳过它
       //如果虚拟机被破坏。
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false;//设置当前不可用
    }
  }
}

/* @flow */

import { _Set as Set, isObject } from '../util/index'
import type { SimpleSet } from '../util/index'
import VNode from '../vdom/vnode'

const seenObjects = new Set();//保证对象，只检查一次

/**
*将对象转换为递归遍历
*getter，以便对象内的每个嵌套属性
*作为一个“深”的依赖。
*/
export function traverse (val: any) {
  _traverse(val, seenObjects)
  seenObjects.clear()
}
// 递归执行对象下面所有属性，进行一个getter触发，来收集依赖
function _traverse (val: any, seen: SimpleSet) {
  let i, keys
  const isA = Array.isArray(val)
  // 如果不是数组并且不是对象，或者是冻结对象又或是节点就不处理
  if ((!isA && !isObject(val)) || Object.isFrozen(val) || val instanceof VNode) {
    return
  }
  // 检查当前值是不是观察对象
  //如果是观察对象已检查过，就跳过
  if (val.__ob__) {
    const depId = val.__ob__.dep.id
    if (seen.has(depId)) {
      return
    }
    seen.add(depId)
  }
  // 如果是数组
  if (isA) {
    i = val.length
    while (i--) _traverse(val[i], seen)
  } else {
    keys = Object.keys(val);//如果是纯对象
    i = keys.length
    while (i--) _traverse(val[keys[i]], seen)
  }
}

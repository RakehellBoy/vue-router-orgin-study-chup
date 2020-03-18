/* @flow */

import Regexp from 'path-to-regexp'
import { cleanPath } from './util/path'
import { assert, warn } from './util/warn'

/** 根据routes配置对象创建路由映射表;  返回3个重要的参数：pathList、pathMap、nameMap */
export function createRouteMap (
  routes: Array<RouteConfig>,
  oldPathList?: Array<string>,
  oldPathMap?: Dictionary<RouteRecord>,
  oldNameMap?: Dictionary<RouteRecord>
): {
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>
} {
  //pathList是用来控制path匹配优先级的
  const pathList: Array<string> = oldPathList || []
  const pathMap: Dictionary<RouteRecord> = oldPathMap || Object.create(null)
  const nameMap: Dictionary<RouteRecord> = oldNameMap || Object.create(null)

  //循环调用addRouteRecord函数完善pathList, pathMap, nameMap
  routes.forEach(route => {
    addRouteRecord(pathList, pathMap, nameMap, route)
  })

  // 通配符 * 调整放最后
  for (let i = 0, l = pathList.length; i < l; i++) {
    if (pathList[i] === '*') {
      pathList.push(pathList.splice(i, 1)[0])
      l--
      i--
    }
  }

  if (process.env.NODE_ENV === 'development') {
    // check for missing leading slash  寻找patch处理后 还是开头不是'/'或'*' 的path
    const found = pathList.filter(path => path && path.charAt(0) !== '*' && path.charAt(0) !== '/')
    if (found.length > 0) {
      const pathNames = found.map(path => `- ${path}`).join('\n')
      warn(false, `Non-nested routes must include a leading slash character. Fix the following routes: \n${pathNames}`)
    }
  }

  return {
    pathList,
    pathMap,
    nameMap
  }
}

// 添加路由记录对象
function addRouteRecord (
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>,
  route: RouteConfig,
  parent?: RouteRecord,
  matchAs?: string
) {
  const { path, name } = route
  if (process.env.NODE_ENV !== 'production') {
    assert(path != null, `"path" is required in a route configuration.`) // path 没配置
    assert(
      typeof route.component !== 'string', // component不能是个string
      `route config "component" for path: ${String(
        path || name
      )} cannot be a ` + `string id. Use an actual component instead.`
    )
  }

  // 编译正则的选项
  const pathToRegexpOptions: PathToRegexpOptions = route.pathToRegexpOptions || {}
  const normalizedPath = normalizePath(path, parent, pathToRegexpOptions.strict)

  if (typeof route.caseSensitive === 'boolean') { // 匹配规则是否大小写敏感？(默认值：false)
    pathToRegexpOptions.sensitive = route.caseSensitive
  }

  const record: RouteRecord = {
    path: normalizedPath,
    regex: compileRouteRegex(normalizedPath, pathToRegexpOptions), // 生成路由正则表达式
    components: route.components || { default: route.component }, // { [name: string]: Component }; 命名视图组件
    instances: {},
    name, // 命名路由-路由名称
    parent, // 父 record
    matchAs, // 起别名用到
    redirect: route.redirect, // 重定向
    beforeEnter: route.beforeEnter, // (to: Route, from: Route, next: Function) => void; 路由单独钩子
    meta: route.meta || {},  // 自定义标签属性，比如：是否需要登录
    props: route.props == null ? {} : route.components ? route.props : { default: route.props } // 路由组件传递参数
  }

  if (route.children) {
    // 如果是命名路由，没有重定向，并且有默认子路由，则发出警告 -- 子路由path:'/' 或 path： ''
    // 如果用户通过 name 导航路由跳转则默认子路由将不会渲染
    // https://github.com/vuejs/vue-router/issues/629
    if (process.env.NODE_ENV !== 'production') {
      if (route.name && !route.redirect && route.children.some(child => /^\/?$/.test(child.path))) {
        warn(
          false,
          `Named Route '${route.name}' has a default child route. ` +
            `When navigating to this named route (:to="{name: '${
              route.name
            }'"), ` +
            `the default child route will not be rendered. Remove the name from ` +
            `this route and use the name of the default child route for named ` +
            `links instead.`
        )
      }
    }
    // --------------------------------递归循环children-------------------------------------------
    route.children.forEach(child => { 
      const childMatchAs = matchAs ? cleanPath(`${matchAs}/${child.path}`) : undefined // / 别名匹配时真正的 path 为 matchAs
      addRouteRecord(pathList, pathMap, nameMap, child, record, childMatchAs)
    })
  }

  if (!pathMap[record.path]) { // 未找到该条记录，如配置文件中两个一样的path(加上父path)后者将被忽略
    pathList.push(record.path)
    pathMap[record.path] = record
  }

  // --------------------------------别名处理 进入递归处理-------------------------------------------
  if (route.alias !== undefined) { //  处理别名 alias 逻辑 增加对应的 记录
    const aliases = Array.isArray(route.alias) ? route.alias : [route.alias]
    for (let i = 0; i < aliases.length; ++i) {
      const alias = aliases[i]
      if (process.env.NODE_ENV !== 'production' && alias === path) {
        warn(
          false,
          `Found an alias with the same value as the path: "${path}". You have to remove that alias. It will be ignored in development.`
        )
        // skip in dev to make it work
        continue
      }

      const aliasRoute = {
        path: alias,
        children: route.children
      }
      addRouteRecord(
        pathList,
        pathMap,
        nameMap,
        aliasRoute,
        parent,
        record.path || '/' // matchAs
      )
    }
  }

  if (name) { 
    if (!nameMap[name]) {
      nameMap[name] = record
    } else if (process.env.NODE_ENV !== 'production' && !matchAs) {// 命名路由添加记录 兄弟间、父子间name都不可以重复
      warn(
        false,
        `Duplicate named routes definition: ` +
          `{ name: "${name}", path: "${record.path}" }`
      )
    }
  }
}

function compileRouteRegex (
  path: string,
  pathToRegexpOptions: PathToRegexpOptions
): RouteRegExp {
  const regex = Regexp(path, [], pathToRegexpOptions)
  if (process.env.NODE_ENV !== 'production') {
    const keys: any = Object.create(null)
    regex.keys.forEach(key => {
      warn(
        !keys[key.name],
        `Duplicate param keys in route with path: "${path}"`
      )
      keys[key.name] = true
    })
  }
  return regex
}

// 返回标准话的path路径
function normalizePath (
  path: string,
  parent?: RouteRecord,
  strict?: boolean // 一般都是没写为 undefined
): string {
  if (!strict) path = path.replace(/\/$/, '') // 去除path末尾'/'符号 ( 如 a/b/  =>  a/b )
  if (path[0] === '/') return path  // 如果以 / 开头，直接返回 path，也就是为什么子路由不让加 / 的原因
  if (parent == null) return path // 如果不存在父路由，则是根节点
  return cleanPath(`${parent.path}/${path}`) //cleanPath去除多个/ ( a//b/c => a/b/c )
}

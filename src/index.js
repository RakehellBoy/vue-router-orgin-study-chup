/* @flow */

import { install } from './install'
import { START } from './util/route'
import { assert } from './util/warn'
import { inBrowser } from './util/dom'
import { cleanPath } from './util/path'
import { createMatcher } from './create-matcher'
import { normalizeLocation } from './util/location'
import { supportsPushState } from './util/push-state'

import { HashHistory } from './history/hash'
import { HTML5History } from './history/html5'
import { AbstractHistory } from './history/abstract'

import type { Matcher } from './create-matcher'


/* new Router({
  mode: 'history', //路由模式，取值为history与hash
  fallback: true, // 进行路由降级 hash 处理
  base: '/', //打包路径，默认为/，可以修改
  routes: [
  {
      path: string, //路径
      ccomponent: Component; // 页面组件, 不能是字符串
      name: string; // 命名路由-路由名称(兄弟间、父子间name都不可以重复, 除非父节点配置了)
      components: { [name: string]: Component }; // 命名视图组件
      redirect: string | Location | Function; // 重定向
      props: boolean | string | Function; // 路由组件传递参数
      alias: string | Array<string>; // 路由别名
      children: Array<RouteConfig>; // 嵌套子路由
      beforeEnter?: (to: Route, from: Route, next: Function) => void; // 路由单独钩子
      meta: any; // 自定义标签属性，比如：是否需要登录
      icon: any; // 图标
      // 2.6.0+
      caseSensitive: boolean; // 匹配规则是否大小写敏感？(默认值：false)
      pathToRegexpOptions: Object; // 编译正则的选项
      stringifyQuery
      parseQuery 
  }
  ]}) */

export default class VueRouter {
  static install: () => void;
  static version: string;

  app: any;
  apps: Array<any>;
  ready: boolean;
  readyCbs: Array<Function>;
  options: RouterOptions;
  mode: string;
  history: HashHistory | HTML5History | AbstractHistory;
  matcher: Matcher;
  fallback: boolean;
  beforeHooks: Array<?NavigationGuard>;
  resolveHooks: Array<?NavigationGuard>;
  afterHooks: Array<?AfterNavigationHook>;

  constructor (options: RouterOptions = {}) {
    this.app = null //vue实例
    this.apps = [] //存放正在被使用的组件（vue实例），只有destroyed掉的组件，才会从这里移除）
    this.options = options
    this.beforeHooks = []  //beforeHooks resolveHooks afterHooks  来完成路由守卫
    this.resolveHooks = []
    this.afterHooks = []
    this.matcher = createMatcher(options.routes || [], this) // 添加路由匹配器 (routes 要求配置时名字不能写错)

    let mode = options.mode || 'hash'
    //模式的回退或者兼容方式，若设置的mode是history，而js运行平台不支持supportsPushState 方法，自动回退到hash模式
    this.fallback = mode === 'history' && !supportsPushState && options.fallback !== false
    if (this.fallback) {
      mode = 'hash'
    }
    if (!inBrowser) { 
      mode = 'abstract' // 非浏览器环境(如 Node、weex), 非浏览器环境下，强制使用abstract模式
    }
    this.mode = mode

    // 根据 mode 进行 this.history赋值
    switch (mode) {
      case 'history':
        this.history = new HTML5History(this, options.base)
        break
      case 'hash':
        this.history = new HashHistory(this, options.base, this.fallback)
        break
      case 'abstract':
        this.history = new AbstractHistory(this, options.base)
        break
      default:
        if (process.env.NODE_ENV !== 'production') {
          assert(false, `invalid mode: ${mode}`)
        }
    }
  }

  /* 输入参数raw，current，redirectedFrom，结果返回匹配route */
  match ( raw: RawLocation, current?: Route, redirectedFrom?: Location ): Route {
    return this.matcher.match(raw, current, redirectedFrom)
  }

  /* 用于获取当前history.current，也就是当前route，包括path、component、meta等 */
  get currentRoute (): ?Route {
    return this.history && this.history.current
  }

  /* install 方法会调用 init 来初始化; 因为new VueRouter可以支持多实例，所以会调用多次 */
  init (app: any /* Vue组件实例 -- 根组件 */) {
    process.env.NODE_ENV !== 'production' && assert( // 判断是否使用Vue.use进行路由插件安装
      install.installed,
      `not installed. Make sure to call \`Vue.use(VueRouter)\` ` +
      `before creating root instance.`
    )

    this.apps.push(app) //将vue实例推到apps列表中，install里面最初是将vue根实例推进去的

    // set up app destroyed handler // https://github.com/vuejs/vue-router/issues/2639
    // app被destroyed时候，会$emit 'hook:destroyed' 事件，监听这个事件，执行下面方法
    // 从apps 里将app移除
    app.$once('hook:destroyed', () => {
      const index = this.apps.indexOf(app)
      if (index > -1) this.apps.splice(index, 1)
      // we do not release the router so it can be reused
      if (this.app === app) this.app = this.apps[0] || null
    })

    if (this.app) {
      return // 如果app已存在直接返回， 确保后面逻辑只执行一次
    }

    this.app = app

    // 新增一个history，并添加route监听器
    //并根据不同路由模式进行跳转。hashHistory需要监听hashchange和popshate两个事件，而html5History监听popstate事件。
    const history = this.history

    if (history instanceof HTML5History) {
      // 调用 history实例的transitionTo 方法 
      history.transitionTo(history.getCurrentLocation()) // history.getCurrentLocation()获取的是字符串(去掉url端口号+base之前的)
    } else if (history instanceof HashHistory) {
      const setupHashListener = () => {
        history.setupListeners()  // 设置 popstate/hashchange 事件监听
      }
      history.transitionTo(
        history.getCurrentLocation(), // 浏览器 window 地址的 hash 值
        setupHashListener, // 成功回调
        setupHashListener // 失败回调
      )
    }

    //将apps中的组件的_route全部更新至最新的
    history.listen(route => {
      this.apps.forEach((app) => {
        app._route = route
      })
    })
  }

  /* 在路由切换的时候被调用 注册 beforeHooks 事件 */
  beforeEach (fn: Function): Function {
    return registerHook(this.beforeHooks, fn)
  }

  /* 注册 resolveHooks 事件 */
  beforeResolve (fn: Function): Function {
    return registerHook(this.resolveHooks, fn)
  }

  /* 注册 afterHooks 事件 */
  afterEach (fn: Function): Function {
    return registerHook(this.afterHooks, fn)
  }

  /* onReady 事件 注册两个回调函数，在路由完成初始导航时触发，它会在首次路由跳转完成时被调用。此方法通常用于等待异步的导航钩子完成 */
  onReady (cb: Function, errorCb?: Function) {
    this.history.onReady(cb, errorCb)
  }

  /* onError 事件 */
  onError (errorCb: Function) {
    this.history.onError(errorCb)
  }

  /* 调用 transitionTo 跳转路由 */
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.push(location, resolve, reject)
      })
    } else {
      this.history.push(location, onComplete, onAbort)
    }
  }

  /* 调用 transitionTo 跳转路由 */
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    // $flow-disable-line
    if (!onComplete && !onAbort && typeof Promise !== 'undefined') {
      return new Promise((resolve, reject) => {
        this.history.replace(location, resolve, reject)
      })
    } else {
      this.history.replace(location, onComplete, onAbort)
    }
  }

  /* 跳转到指定历史记录(n可以为负数，表示后退) */
  go (n: number) {
    this.history.go(n)
  }

  /* 后退 */
  back () {
    this.go(-1)
  }

  /* 前进 */
  forward () {
    this.go(1)
  }

  /* 获取路由匹配的组件 */
  getMatchedComponents (to?: RawLocation | Route): Array<any> {
    const route: any = to
      ? to.matched
        ? to
        : this.resolve(to).route
      : this.currentRoute
    if (!route) {
      return []
    }
    return [].concat.apply([], route.matched.map(m => {
      return Object.keys(m.components).map(key => {
        return m.components[key]
      })
    }))
  }

  /* 根据路由对象返回浏览器路径等信息 */
  resolve (
    to: RawLocation,
    current?: Route,
    append?: boolean
  ): {
    location: Location,
    route: Route,
    href: string,
    // for backwards compat
    normalizedTo: Location,
    resolved: Route
  } {
    current = current || this.history.current
    const location = normalizeLocation(
      to,
      current,
      append,
      this
    )
    const route = this.match(location, current)
    const fullPath = route.redirectedFrom || route.fullPath
    const base = this.history.base
    const href = createHref(base, fullPath, this.mode)
    return {
      location,
      route,
      href,
      // for backwards compat
      normalizedTo: location,
      resolved: route
    }
  }

  /* 动态添加路由 */
  addRoutes (routes: Array<RouteConfig>) {
    this.matcher.addRoutes(routes)
    if (this.history.current !== START) {
      this.history.transitionTo(this.history.getCurrentLocation())
    }
  }
}

function registerHook (list: Array<any>, fn: Function): Function {
  list.push(fn)
  return () => { // 返回函数用于清理注册的钩子 -- 闭包实现
    const i = list.indexOf(fn)
    if (i > -1) list.splice(i, 1)
  }
}

function createHref (base: string, fullPath: string, mode) {
  var path = mode === 'hash' ? '#' + fullPath : fullPath
  return base ? cleanPath(base + '/' + path) : path
}

VueRouter.install = install  // VueRouter进行属性方法，供Vue.use( ) 安装vue-router插件
VueRouter.version = '__VERSION__'

if (inBrowser && window.Vue) { // 非npm安装
  window.Vue.use(VueRouter)
}

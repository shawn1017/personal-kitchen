export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/orders/index',
    'pages/cart/index',
    'pages/recipe-manage/index',
    'pages/category-manage/index',
    'pages/recipe-edit/index',
    'pages/recipe-detail/index',
    'pages/recipe-import/index'
  ],
  window: {
    navigationBarTextStyle: 'black',
    navigationBarTitleText: '私人厨房',
    navigationBarBackgroundColor: '#FFFFFF',
    backgroundColor: '#F5F7F5',
    backgroundTextStyle: 'light'
  },
  tabBar: {
    color: '#8A918A',
    selectedColor: '#3E9B55',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '厨房',
        iconPath: 'assets/icons/tab-home.png',
        selectedIconPath: 'assets/icons/tab-home-active.png'
      },
      {
        pagePath: 'pages/orders/index',
        text: '订单',
        iconPath: 'assets/icons/tab-orders.png',
        selectedIconPath: 'assets/icons/tab-orders-active.png'
      }
    ]
  },
  lazyCodeLoading: 'requiredComponents',
  sitemapLocation: 'sitemap.json'
})

import { Category, Recipe } from '@/types'
import beerDuckCover from '@/assets/recipes/beer-duck.jpg'
import braisedRibsCover from '@/assets/recipes/braised-ribs.jpg'
import pineappleWingsCover from '@/assets/recipes/pineapple-wings.jpg'
import steamedFishCover from '@/assets/recipes/steamed-fish.jpg'
import stirFriedBeefCover from '@/assets/recipes/stir-fried-beef.jpg'
import tomatoEggsCover from '@/assets/recipes/tomato-eggs.jpg'

const createdAt = 1767225600000
const categoryNames = ['肉类', '海鲜', '蔬菜', '汤类', '主食', '甜点', '其他']

export const seedCategories: Category[] = categoryNames.map((name, index) => ({
  id: `category_${index + 1}`,
  name,
  sort: index,
  enabled: true,
  createdAt,
  updatedAt: createdAt
}))

const seedRecipeData = [
  ['啤酒鸭', 'category_1', '鸭肉焯水后与香料慢炖，收汁时保留一点汤汁。', ['鸭肉', '啤酒', '姜片'], ['鸭肉焯水洗净。', '炒香姜蒜与香料。', '加入鸭肉和啤酒炖至软烂。']],
  ['菠萝鸡翅', 'category_1', '酸甜清爽的家常鸡翅，菠萝最后放更有果香。', ['鸡翅', '菠萝', '生抽'], ['鸡翅煎至两面金黄。', '加入调味料焖熟。', '放入菠萝快速翻炒。']],
  ['小炒牛肉', 'category_1', '牛肉逆纹切片，旺火快炒保持滑嫩。', ['牛肉', '青椒', '蒜'], ['牛肉腌制十分钟。', '配菜炒至断生。', '大火下牛肉快速翻炒。']],
  ['红烧排骨', 'category_1', '颜色红亮、咸甜适口的家庭做法。', ['排骨', '冰糖', '八角'], ['排骨冷水下锅焯水。', '炒糖色后放入排骨。', '加热水小火焖至收汁。']],
  ['清蒸鲈鱼', 'category_2', '蒸好后倒掉盘中水，再淋热油和蒸鱼豉油。', ['鲈鱼', '葱', '姜'], ['鲈鱼处理干净并改刀。', '水开后蒸八至十分钟。', '铺葱丝，淋热油和豉油。']],
  ['番茄炒蛋', 'category_3', '简单快手，番茄出汁后再回锅鸡蛋。', ['番茄', '鸡蛋', '葱'], ['鸡蛋炒熟盛出。', '番茄炒软并调味。', '倒回鸡蛋翻匀。']]
]

const seedCoverImages = [
  beerDuckCover,
  pineappleWingsCover,
  stirFriedBeefCover,
  braisedRibsCover,
  steamedFishCover,
  tomatoEggsCover
]

export const seedRecipes: Recipe[] = seedRecipeData.map((item, index) => {
  const [name, categoryId, description, ingredients, steps] = item as [string, string, string, string[], string[]]
  return {
    id: `recipe_${index + 1}`,
    name,
    categoryId,
    coverImage: seedCoverImages[index],
    galleryImages: [],
    description,
    tips: index === 0 ? '啤酒已经提供足够液体，不必额外加太多水。' : '',
    enabled: true,
    sort: index,
    ingredients: ingredients.map((ingredient, ingredientIndex) => ({
      id: `ingredient_${index + 1}_${ingredientIndex + 1}`,
      name: ingredient,
      amount: '适量',
      sort: ingredientIndex
    })),
    steps: steps.map((text, stepIndex) => ({
      id: `step_${index + 1}_${stepIndex + 1}`,
      text,
      image: stepIndex === 0 ? seedCoverImages[index] : undefined,
      sort: stepIndex
    })),
    source: { platform: 'manual' },
    createdAt: createdAt + index,
    updatedAt: createdAt + index
  }
})

export interface ReferenceFood {
  id: string;
  name: string;
  aliases: string[];
  serving: string;
  calories: number;
  protein: number;
}

/**
 * Approximate values used by the demo interpreter and the seed data.
 * Nutrition figures are estimates, not lab measurements.
 */
export const REFERENCE_FOODS: ReferenceFood[] = [
  { id: "egg", name: "Egg", aliases: ["egg", "eggs", "boiled egg", "omelette"], serving: "1 egg", calories: 72, protein: 6.3 },
  { id: "banana", name: "Banana", aliases: ["banana", "bananas"], serving: "1 medium banana", calories: 105, protein: 1.3 },
  { id: "milk", name: "Milk", aliases: ["milk", "glass of milk", "milk glass"], serving: "1 glass (250 ml)", calories: 150, protein: 8 },
  { id: "oats", name: "Oats", aliases: ["oats", "oatmeal", "porridge"], serving: "1 bowl (50 g dry)", calories: 190, protein: 7 },
  { id: "roti", name: "Chapati", aliases: ["roti", "rotis", "chapati", "chapatis", "phulka"], serving: "1 chapati", calories: 104, protein: 3 },
  { id: "rice", name: "Rice", aliases: ["rice", "chawal", "steamed rice"], serving: "1 bowl (150 g cooked)", calories: 205, protein: 4.3 },
  { id: "dal", name: "Dal", aliases: ["dal", "daal", "lentils", "sambar"], serving: "1 bowl", calories: 150, protein: 9 },
  { id: "paneer", name: "Paneer", aliases: ["paneer", "cottage cheese"], serving: "100 g", calories: 265, protein: 18 },
  { id: "chicken", name: "Chicken breast", aliases: ["chicken", "chicken breast"], serving: "100 g", calories: 165, protein: 31 },
  { id: "curd", name: "Curd", aliases: ["curd", "yoghurt", "yogurt", "dahi"], serving: "1 bowl", calories: 98, protein: 5 },
  { id: "idli", name: "Idli", aliases: ["idli", "idlis"], serving: "1 idli", calories: 58, protein: 2 },
  { id: "dosa", name: "Dosa", aliases: ["dosa", "dosas"], serving: "1 dosa", calories: 133, protein: 3.5 },
  { id: "poha", name: "Poha", aliases: ["poha", "puffed rice"], serving: "1 bowl", calories: 250, protein: 5 },
  { id: "maggi", name: "Maggi noodles", aliases: ["maggi", "noodles", "instant noodles"], serving: "1 pack (70 g)", calories: 350, protein: 8 },
  { id: "samosa", name: "Samosa", aliases: ["samosa", "samosas"], serving: "1 samosa", calories: 260, protein: 4 },
  { id: "bread", name: "Bread", aliases: ["bread", "toast", "slice of bread"], serving: "1 slice", calories: 70, protein: 2.5 },
  { id: "peanut-butter", name: "Peanut butter", aliases: ["peanut butter", "pb"], serving: "1 tbsp", calories: 95, protein: 4 },
  { id: "protein-shake", name: "Protein shake", aliases: ["protein shake", "whey", "protein scoop", "scoop of whey"], serving: "1 scoop", calories: 120, protein: 24 },
  { id: "almonds", name: "Almonds", aliases: ["almonds", "almond"], serving: "10 almonds", calories: 70, protein: 2.6 },
  { id: "chai", name: "Chai", aliases: ["chai", "tea"], serving: "1 cup", calories: 60, protein: 2 },
  { id: "coffee", name: "Coffee", aliases: ["coffee", "black coffee"], serving: "1 cup", calories: 15, protein: 0.5 },
  { id: "tofu", name: "Tofu", aliases: ["tofu"], serving: "100 g", calories: 144, protein: 16 },
  { id: "rajma", name: "Rajma", aliases: ["rajma", "kidney beans"], serving: "1 bowl", calories: 170, protein: 9 },
  { id: "soya", name: "Soya chunks", aliases: ["soya", "soya chunks"], serving: "50 g dry", calories: 172, protein: 26 },
  { id: "apple", name: "Apple", aliases: ["apple", "apples"], serving: "1 apple", calories: 95, protein: 0.5 },
  { id: "orange", name: "Orange", aliases: ["orange", "oranges"], serving: "1 orange", calories: 62, protein: 1.2 },
];

export function findReferenceFood(id: string): ReferenceFood {
  const food = REFERENCE_FOODS.find((entry) => entry.id === id);
  if (!food) throw new Error(`Unknown reference food: ${id}`);
  return food;
}

export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Food: ["food", "breakfast", "lunch", "dinner", "snack", "cafe", "coffee", "restaurant", "swiggy", "zomato", "canteen", "meal", "samosa", "chai"],
  Transport: ["travel", "traveling", "travelling", "bus", "auto", "metro", "train", "cab", "uber", "ola", "petrol", "fuel", "fare", "college bus"],
  "Mobile recharge": ["recharge", "mobile", "sim", "data pack", "jio", "airtel", "vi"],
  College: ["college", "fees", "fee", "tuition", "books", "stationery", "exam", "hostel", "lab", "xerox", "print"],
  Shopping: ["shopping", "clothes", "shirt", "shoes", "amazon", "flipkart", "myntra", "groceries", "grocery"],
  Subscriptions: ["subscription", "netflix", "spotify", "prime", "icloud", "youtube premium", "gym membership"],
  Entertainment: ["movie", "cinema", "game", "gaming", "concert", "outing", "trip"],
  Other: [],
};

export const INCOME_KEYWORDS: Record<string, string[]> = {
  "Pocket money": ["pocket money", "allowance"],
  Salary: ["salary", "stipend"],
  Freelance: ["freelance", "client", "project payment", "gig"],
  Gift: ["gift", "birthday money"],
  Other: [],
};

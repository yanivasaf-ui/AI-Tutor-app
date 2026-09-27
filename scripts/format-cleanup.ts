/**
 * Format cleanup — a GUARDED, REVIEWED script. Nothing here touches the
 * database by itself.
 *
 *   npx tsx scripts/format-cleanup.ts --precheck   one read-only SELECT: every guard's value, today
 *   npx tsx scripts/format-cleanup.ts --sql        the transaction (run by hand)
 *   npx tsx scripts/format-cleanup.ts --readback   read-only SELECTs for after it ran
 *
 * Removes the bank rows the allowed-format table keeps out of serving
 * (docs/bank-audit-2026-09-26.md): 677 rows whose format the table does not
 * allow for their topic (query C of scripts/audit-format-fit.ts) + 11 bare
 * number lines under operations topics (G5). The id list below was
 * materialized from a fresh read-only run of that selection on 2026-09-27
 * and checked against the database's own fingerprint (md5 of the sorted,
 * comma-joined ids).
 *
 * The transaction aborts — and rolls back everything — unless ALL hold:
 *   1. the id list's fingerprint is the audited one;
 *   2. exactly 688 of those ids exist in the bank;
 *   3. every one of them still fails the allowed-format table (a row
 *      changed since the audit is not deleted);
 *   4. NO exercise_attempts row references them. exercise_attempts.
 *      exercise_id is ON DELETE CASCADE: deleting a bank row erases every
 *      child's attempt on it. On 2026-09-27 55 of the 81 attempts (all 3
 *      kids with history) reference these rows, so as written this script
 *      REFUSES to run. Keeping or archiving that history is an owner
 *      decision; this script does not make it.
 *   5. the DELETE removes exactly 688 rows.
 */
import { TOPIC_FORMATS, allowedFormats, hasCondition, isServedTopic } from "../lib/map/topic-formats";

export const EXPECTED_ROWS = 688;
/** md5(string_agg(id::text, ',' order by id::text)) over the ids below, as the database computed it. */
export const IDS_FINGERPRINT = "5150c3b5300b11ae995146ec1890dea6";

/** The 688 ids, without dashes, sorted. */
export const CLEANUP_IDS: readonly string[] = [
  "00e01290b8044df2a00dbd16aa325118", "00ebeb6ecf364a02861ae76ebdef9469", "0113a8bb7a264055824c1004265f3c26", "023ffe3a7d02447081466a3d84b32007",
  "029635d908574623a3d8d05aab280397", "02b06cbd4fa24476857f46dc5876423b", "02dc72190da44c58b2f13235536a638e", "02ebf256a4df4ced93976b22c3983402",
  "02fe429089394c639e0da2f20c5b9c54", "0333d533abef4986aac291db5872abf1", "03ea30c5886841df83534a8ebf75176a", "0433ddcf14fe47d78381654d9fc6c79c",
  "04473830370e4c6bb0ca83c520d64e25", "0457993ff2744dfebdb59d6d8e41b892", "04a98246376b46269c530a1543830d08", "04ee6ce3f3f64f10bd5a4fce3692fa6d",
  "04f97e849de44cefa5d27b13d4ada832", "05747d6148384397b455dd19a8eca9a5", "0592ef8b1427412ea2db9e0ccc8b1dda", "06fa29c8ad2d4cf0aae1e1a50e6d5d4e",
  "0703a3498f034823bb3b7c63f38a26dd", "070cfa7c6c044174a1e860bfe4ac416f", "089a5ea0db934442b28f0ceb1db42dd6", "08a6ee7735544944900226ae479e11dc",
  "08d646cec26c440e90f02c6746903d94", "08e05490dd544d239d79a5f422e47c62", "092a5bcf45e34c2cbce3594502ca085b", "0a213cd278bb49c6b5891e164ab2438c",
  "0a3717c7014840c7b12f3a06e1f5312d", "0a99d189014543faaddc945aa4f513e7", "0ab6ad557ab84fa59839f5a203f8d778", "0b238979316d44b88ff563867929dccf",
  "0b876c844c174c6889389accab74c6e4", "0be6a6a187c94b029076b68ed35d9a39", "0c0944fd4806449e840974d91611f8c4", "0ca2e16b2dcc4d60baf9a0a0a4c19bb1",
  "0ccef4ab09a44b1999843dd65a9bf1a0", "0cd1b61ae73f4b1982bd4055155c5ee5", "0d6f8d21153646fa991bb9014603ef0b", "0d7b930a97da4082aabf38e4d98b3292",
  "0daf010fd3ad447cb3c8562904047a6f", "0e48b89ba1114818b9b6122d38aa3316", "0e55caa783664d1486634990306b1f47", "0e92fd6effc6497b8a200510e9d649ac",
  "0eaad9a4f290446eb98c72814a246f26", "0eb6a977201a461c98b7e548efada77f", "0f09c053a1534e5b9c7c48dbfafcd699", "0f0e35ef2c4f4ed79ea0388cf7b1603d",
  "0f374321bddd40299e45a8c5524a4eaa", "0f758b0f2b0e4daa9d3ddc29f3ffb3a8", "1126d8b30b1a46d5965abaff6b66d226", "11c0aaba26104301b3f7994676d94951",
  "121fa759a7f74bbc8f3a997836c2964b", "1263f8cf1198478588ab5f4a21c1964b", "1270dbd3bbf5473c8f1ad803142a81f0", "1371bae79ca145e695ace97289e47dff",
  "139e3421854a43c489edb60e9788fdf1", "13e4f7343bd6403881144fb00b523d48", "1405203bb1664538ac361492811f30a3", "14a0b2b922ac4126bd0639bb271b0bca",
  "14a828b79c88448996e8c6943f918ec1", "15cf1731ed414edda249b080ff7e9e72", "15f75ac07b6848e5a25bfeb7e1255a27", "162934038e8943c7b4350fece92862d6",
  "165a5e9db82d4ebd854de07b40610564", "1687a6b669d64f58808cf92313f9dd15", "1699711fda9146998d2943a8a912b7cf", "169fa66b658141e68680e162cdab4a1d",
  "16ae634513484905adbe1e80c7a817c2", "17d50b255e30480db358e512f0c97854", "18a364f319fb49abb4761b6019a19841", "18bf948f037540269176e67bcb9008ee",
  "18fefa68505645f296cd5337a73c09dc", "190df8933f8a4e59ad1c5b633666c08f", "19a82b2a0cec4301be75bff2d4c3c74c", "19b832a5cd0543739a33cd5a51f68f5e",
  "19e65e56a84141c49dc5a941fb0faa18", "1a0be6ebf5414890835103a8f9dd39c3", "1ab268dfc5724e2fb7ad1404f41a4f10", "1adca599e94f457cb9ac31cd4a81463b",
  "1b10bd5e899c43a69b94971ee00b93be", "1bb25982150a45249581f5d59a3193bc", "1bb375564f9e40fd88cb5c27e590e3c4", "1d0365f3521743ddb04d1d9a69259cd6",
  "1d9d89ee68ab4919be611a8ed6b0a4be", "1dd8c6921ed249cea1e792f306f09be2", "1e2323f0b93544e09c13c80c0c81e97c", "1f00aa61906343fc896c7913ceed1a93",
  "1fe552ac2dc94d2aae666cf8654b5208", "2012d09c44b1476bb27d127d271a91b4", "202d44649c304d5eb62b38aa8a12816c", "215f080954004969b507e552f181d124",
  "21b012208c01458ebd3326b79664707a", "21d282e2810941d8a81556e800179ca3", "23425e07dc854b0195691831be1c2d70", "2381cd16b93a44608fc5a6794a4976fe",
  "2397c66b1cda409a924f6a05452fef84", "239a1f532b9f4144b65751ea7f7bce1e", "23bdf81cb5ac4cbaa56e3a2fdbafa93e", "243d883f78734c038842ea07d894a74c",
  "246d94056fa64f17bc900a09f089a73a", "24ca2b2b17b34297b445b1db77c48c53", "24def94008464f9c99521c3153522551", "250235c72ae3409aa464f5a81a27bc58",
  "25313afb267a40d2989c3bc1967363aa", "259be30029d641cba5c590d96effbdf0", "25ceceb3c77f46f88919b8ddeec49166", "27077452aa5247338cd04a768464dd63",
  "2764323d12f3429eac1e8f832108fa37", "278a5461a8c941b5a92dfa877fa85c2f", "27f6fcd2ac20471c81d476a40140ec34", "280753211acb4fba8a3efdf18d3ff06b",
  "29695cdf3d1a4ac4abcf98def0fdf617", "299e1a89da6d4b4e97df5f480372b62f", "2b04500601974ef890f50072fe536edb", "2b36db9704d94f24a8f9803f166947c6",
  "2bb41114c52446a1b5e1814f7eb38fc0", "2c47a9dc88cd4ec987c5f5ac4720067c", "2c4c6216ee2f4d6f8ba875bf52d37990", "2ca354c8dc0d47db9050fe7efd5df241",
  "2d0ba7cf186d4761b9b450b103078d24", "2d17cacec0cf4aaeb0d6b1fec6980d89", "2d50ca729dad46208d501b0d7b864379", "2d6cd1e1e68043f095e602e3db338a5b",
  "2d74add343fd4b73beb6cf52b75255df", "2f0bf6d5952f41ba92511b495a2e6027", "2f0eef3c0d694ac69cf48ef93b6389d8", "30865375cbf44722a0c7b0fdd673e0ea",
  "30f0070697254a71adb18823bd7345ed", "3188c56d20c142d596ecb57111efe675", "31d778ed29a54d57bcd96ba2ef3356b1", "31e2ec962af34eb3b15cf43405a3e35c",
  "322d168ba5f34ef3ae3dc24d086a941c", "332ad14550354e5689bbd299f02e2c1c", "33f1c078912e4abd955a64bf0262eb32", "3445c4c292404c72b2e85908bb34d9f1",
  "3465a9128f9f4763aa0b674925cfa71b", "34c4b9fa880f4886bba9d9bbef1a05c0", "34dfba8011544acda24df7c788857bfb", "351729b79e85458abc5531788dc5d5df",
  "3519af8e810c430cabcb59addea245be", "353892673b5d45fd95cf801b0e9ecfc1", "35adaba84cf94257b14e1d549c05ae4b", "360fd409f1b249b59256dd66578b7a07",
  "3622b59aa3fd451098e806f66f382823", "3649e14d9b8442c6a8f9f38e6709b58b", "36a605a6b6704210b6f8ebbf9cf495bc", "36bc501b28ff40c6a7d2e7e2ad8d9550",
  "36c33c7565a4421c9e34d471b3ef3161", "36ede2d3f142472ca813c09da7ed6601", "37a3efe426b64850b1487de8574f9dc0", "3839fa6a71fd4c1e8e83ef21fb18ad70",
  "385f68ceb0a64028a112c7b7ffdb1452", "38dfbdb62f574886b78db6035cea81b8", "397cdc8535e042a49368a44974f9cd33", "3a100e85e9ae47d4b3bb345b56074b63",
  "3a4f189b2d984463886e7294f0ef031f", "3b666749c94c4cf681c4f4adae7be922", "3ba214cd390a4266bf67c3536538a7e6", "3c6ae5bfbb544ed8abb93cdd2e01f606",
  "3c90181309b3468f8d917c35a3662cee", "3dcc48d39e1c4bd6a473dc87a0cff7d7", "3ea60a5d02ac4704acd87fea9c92d61e", "3f20c73ca26943a490a1332e8ba10b26",
  "3fda676b72094511b1ff77981526c1b3", "401cd25e18634a44946badbcd7f401bc", "40f9b8dc3f844edf9de5a23bb10b3ade", "412e4811cfd644efbc5c0f2c8d4dcb64",
  "415d65d25fe6439c9a663ebb567c92e3", "41904b6bc82c486c857997b386ab55ba", "41ac1636e169494481700072b64e7502", "41e8f77463b241ca990f73d3ddfb05d9",
  "41eb41b01ff247f39d168668a4fd76e3", "422f2f93495544cfa500c21c2a52aed8", "42b163addd3a406094be6bc10eadc20e", "42dcc9468f684da0a6a082ba1d68657a",
  "43fcc8fdaa784a00a9c0a7b04a1ffc55", "4449528782db44759c9db95bf9bc4c7b", "44977a5ed275409384e5a00cd22f27ee", "44d14c48c9964480b9a4d9b6aadbadb8",
  "450a2e5a95ca4347bc4b980c87fbbf5d", "450d68c36d524fac996d01c70bcd96e5", "458e4e8ca598424a9b12da878ff0652d", "45b42b8a236b44c6a9efbae5b071d710",
  "45bbc86531594620bb71eac86b5ee785", "45c5bd6c6605467bb80b25c77744ae66", "4624bd891d2141b58f9087acda33794f", "4638055bb6194e118c77c0dfc2664afc",
  "4640650df3b54813b7146a0fcc8f5b56", "46b5ef60a8bc4f34acd6f60f41778a6f", "470c54b0035741f699f230c2bd8f023c", "47356910df7748ad946a5d5b780b1038",
  "48315ea121594b598a5bd093d1a9953d", "4852143aae944c288a76ff710792eb42", "48dd8de13ef747869a72effcebc11345", "49305562eb50433cb52296b3a4167efc",
  "496c7c6bc53049ad9e0b72624acd7786", "49d04c3a05894c229351df7b7435de70", "4ab9694ce1a84e3db2dc287c07ed9e70", "4ad39da40feb4b7db328476f49dd70e4",
  "4af1728f0de44699b8513638aacba5d8", "4b09c27b82e845668d1383c9badce4c1", "4b4f58e0c81a48519ff9b8cfd850852b", "4bde9668a9574c0097345c813b5986fc",
  "4ca8c002a54d44c49c9765693fbc70e4", "4d5fab7c9bc24534865dfd77a7e4682f", "4d7a7035ecc840daabde101326e85be0", "4d84a7baa3f0466ca498eda1e59c0a34",
  "4de81b66459549578c2a43ae3e0a38de", "4e54758d060d4efc8f1dc3ae13d05ffb", "4ec6f8d7009d4a9f8a01f2a70c009ecf", "4ee090c4d47a4f4998d79a2fda07bbd5",
  "4f4d9686a9d544739bfdbc63f64f2e9c", "4f79a2dbf8f244e8842a1a1f7327448d", "4f9ac4e07b614543b1af237cb0a9182d", "502eddb619254b89875a77e7ee9cd8f0",
  "504931a975c3477381ec2885bf987530", "508700aee9894ff39281b3376aef22e1", "515a98560a78437ab07cf92c30ab05ff", "51f0148b7ba2493a81991bb30a4cb2cc",
  "52bf023d91fe463aae826e3dfc02a756", "52fc5024a65c4e938b0c8c2b405c017f", "5306f11fcbaf42b1bd5fcfb75555184c", "532e89866e9f4bc3a34c77537aa4d30b",
  "538acea4f78c49388e245571dd2f54d0", "53ef285f927744c595b0a2c451251e20", "54ba851a027c445e8cb2ac868c6fcb60", "54d8caa416f541beb2b305f5b73044aa",
  "55324b9f3d1f44a8ae33e368c548f98f", "55444ed87cc04d158f87b230d5a8b4bb", "5548ef2a1c464820aeb499c38d0b9e9f", "5552d909087a4789815daa241a3bdd0a",
  "55806c8627224a7e847904be8803d0f0", "55c367977eec486ca9391c0a1615f035", "565d998bcbc9478f9cdbb9105bc76eca", "56ce160b593a4fdfb9a9f3a1f5a79e61",
  "56cf94ee15c24d2c892c14c23beb1f6f", "57215c27a4aa4f348171c97110b9db3b", "575d816234b7405e9645210ad8aee3d9", "57dfe8ae2a354b5081e5d198651ec1ff",
  "582f0cdd69ef45f9ab82efb6abfbd7a2", "582f9705b1024244badb56a063eabae7", "593466144ab743d9bec9260c1c99de19", "596d7ceaf6474b8a82c5e2d243845a51",
  "5995c695a5134c2e85b6496c277a9a5d", "5a1ea7351967489d8f8df4277c5469a2", "5af695a1a6ee42e3be1d887654a354fb", "5b22a03b7c6443ed9cccba744e7c038b",
  "5b6f2e2d7c6c402092ecd7ae0c8c8ac3", "5ba0c169ac654cfb805fdbf2a68dc589", "5be99c5c0bfc4f66b88b8a5e3e7eec91", "5c5ca723b86448f99f97809330f36864",
  "5c9effeb304a42919bcd2970e3acca18", "5cb87ca09ff7428abb15fc60cbafc1e4", "5cc6f8d9375b42e0b357038343302329", "5cf9107d52994fedbef1e3b9db9335fb",
  "5d2dec624d8d47308f45a353fa483ff1", "5dbc7468d1eb48dfaeff716bf2a1efa9", "5e35f90d57ac42db8d81befd52278266", "5e37e9a35393487e8a527d3aace480a9",
  "5e732e1836924b8a90bace103ea6d8c3", "5f1ce6daf0614c33a6661cdc304b2e2a", "5fc79a17eba74adb9328c8abaefd84b0", "606c070902894276aa20956c9ce873a3",
  "614bbd63e73b426594f2cdc3de944956", "61d6d33b9d39489596d8e6a747ba28d7", "620e9789666b445f84e491a3b377432c", "622e2f65cad4405ba0f277e5fa20c467",
  "630b3bcf023c42729b5a155cb4c15b49", "637e9d86940b46cf9bb5b59479ced010", "643bd473f3224bfaad1bceedc2c00f47", "64444b22eec34ef1958813c75abcfc17",
  "645a243f70f14c7db5c3bab207f7ea2b", "65016789a0194a0781cc6d1528e4a55d", "6516b0c565ce45d0aea95a304a971bdf", "651aacb395134ee0a5dd7e8a3acd005c",
  "6569572d6c9c440886e1e1df2c68d1c9", "662200ec7f2e4047858ceb24b4593973", "664057daa5d348a1a541811dfecb99c3", "6643e1a8d8bc467799522fb03f085967",
  "6679f7c5336449fb8010452bee0b494d", "66a11e6694ce47cf868e81be11528fbc", "6721530f9fea4b7a9c30d41d288cb033", "675ecd35cd894efbb61b6ec9dc696aae",
  "67f12c0cb78947c994b69bee97f246b8", "68080603bb5c4b4d836782473fbb096b", "68dde6d5350e40e6be7b457fb7722ef6", "6911cd9419924364b0bde41f8eae6ebc",
  "699fdd746768448cb01c97bf59fb7277", "69c791c04b594d4588afa0788e136f51", "69ccc0f5da494ef48dc23a8329411fc0", "69da0ca9b9d947c9a41398e2265b3b24",
  "6a371081abe44031ba7a79050065bf05", "6aed9dfb8ced4b748c4e26bbee276d6c", "6b01bab7933f450ea378b3ec434ca607", "6b57f0e8ac32417e9a7cf6eb899fa738",
  "6b76f3f3ab0a4331bf001045959d0c84", "6bbc4bfa2a4c43bc9d462f54f34c8a92", "6c52039bc4654dc689c66f1e2398ca0d", "6cfde79873c5414aa2b4ae3b7b216af0",
  "6d15110cd1104957acdc94cdf5befa09", "6d95bbfc550f48658751660367e135bd", "6e09b0facf524e509bf37d9515538690", "6e55fa84e8914c458ee610e9dc651e15",
  "6eae553ea7004286935c73241fc8b1ac", "6ec6f3d933f04d90a56c7d60e159ce41", "6ed1b2848c17482a80e701a7a432ccf4", "6ff13d4245b5416c80e31c8baae459cf",
  "70163fb9862c4de79dc334f78902d058", "70bef07df4d3412e9136f61e02972531", "70c19fb9c356468099a1113c9a98db68", "710757cfecf24d0f8a4f37fb341c7b7f",
  "715cad8cca414c7e80c3efe8f60492fa", "718023ef14034d43badc3d51a55180a3", "7197fe00695a490195ad3616e31baedd", "71988afc314e4d52beb0ae88468298f0",
  "72551746eec8444c95ffef873df488a3", "729fb34406d34e26b990c0f2c3422735", "740bf8280880461c82271285f5b1bb8a", "75de3860e05a4923bf073c8bb25c3063",
  "763d823320b14a5bb889f4177081e0d8", "76bdd0483ae7491bb68b2be4ae69e700", "774f43c85d824fd3a9cd9b98f7e594e7", "7838cbcc1e4d4d4ea30ce0fc6e11235f",
  "784fb7199c834b7c993db6e81815ed20", "78565e3cd51d468abaa6c712bf1153fd", "78c0e1d1468346bc93ab1f67b3e547c8", "78d0cdca08f54043bff0950f0787fc77",
  "796fe5d2a33243e3871148c4bc7acb8d", "7989a0292ebf4588bdba7a41c2b2887a", "7a75e5306270461082b7378dd11e7ff7", "7aa2d5b968944ca59f5718be557d6412",
  "7b3b97283cd447429206c11cb82314ac", "7baebf8508594688b63cee6c45e03f2e", "7cd01a0a7f8b44f790421c6eaf36b298", "7ce2de2e1d3d43eda7eba97b46316455",
  "7e1d6f1f937445c883a2d61b733ac9f9", "7e2a603076ef474c930e02a7d74316c0", "7e349d676f5a48f9824d8f17a3ddb7e2", "7e42c251dfb44558bcf3b15f27e2fad8",
  "7e65cdffa516481b87c534271d58bc21", "7eff537f36e543f49a084e204876607d", "7fbe41625d4347a3b895b771e8c87ee2", "804ae2af8d7e4bdf89c4d279c880e776",
  "805501cd2c574e999f895a4817b87bc6", "807a28fd93f34cebae052b22e1e33d3b", "807db1fa258544be9aea77d0946098ba", "813164305d8945d0a721471e862da80c",
  "813cbe4a5c41478c809cac9d600c381f", "8144236b21f6476398187f0e660d8176", "81e4e27bc3c14fbca2f1e9ed52e88219", "81f899f3eced4cc6bcb33c26e5ecc924",
  "8237c9c2446b4b61955444fd654cf4b2", "82b1c46ee7994ba8a2af688a91f43f22", "830cac2ab22c44fbb5f9b21e6ba87c3c", "831365efe0c24de7a41fdbe54b2be506",
  "834b993c163c43208d6b1c8f86d6b31f", "8358b306245b4c49867554d6d7495124", "83b028e0cb644eeeadc3953935ed85df", "83d1e979da484fd4bb0131d9573f39f1",
  "840428ff88fc43fea75c9393a547f883", "84459a6a419d4936913882a7a9b43d57", "850412e2e2b84502818366eca06841ee", "85457cdff0b14e8c841a5f89982a3f9e",
  "85ac41a02b104a6aaedc4a07ae2682eb", "85c853f82f92471b9fb041ac847a5c70", "85fb100be6bf405387abca249c0cce59", "86415992851e47e3ba442ac42d6d478b",
  "8641e31b7e6e4daebf6e36cfc3233dda", "86d88241690944ed802193a38bc6f433", "8727981669ce48ba894df49c4a77179b", "87281ad819124134a00b2b0937582161",
  "875c130d2f0f404c95014dd644076c02", "87880b06b8a446009e80bbaa4e3976c3", "878f438dc4e54038a13b69a16a5e3999", "87aaa68fde9d49afbfb61acf44d28c48",
  "87d2183cf9844c1695eb97d8d1782e62", "889050f0a43b4ed2a41289ae6298c2e8", "88aa518b1f2540c291bd2108b8e2aa70", "89a6e31346d6424b80fe63d0585a6dfa",
  "89b79299bef0493b9158f14f8a6c5511", "89e70b73e748403c964491103a94fc41", "8af06b0c8322486381617550399e318b", "8b7869e47c8c4a31b632e08dc5e526a9",
  "8c8314e3fedf43e8842361aaeb79849f", "8cf3c212a171497ca3e734b6f9da5046", "8e0b67dd048c40aeb92c53d6fb4ef332", "8e290f504f444a0689b650e7468b5420",
  "8e543fef5f194463a4469a3c53d91b9c", "8e757f9a158141fea96cc5086e7bea6e", "8eacaab3a0474985960a7ceb6539a695", "8eed3031543742bca3872dffbeba00a1",
  "8ef7e265c865440abc5073321b10db9e", "8f88868fd441447ca026b5f60928cef9", "90018a69870a4855bdc0f322e49e49a6", "905a873c0edc4616911636ca8b12813b",
  "90ec071ab6b84441a970d2b68b75024b", "91b0224251e0494686505ada417c4912", "91d34883fd824346965ff50036fe5e7d", "9316e04eb57d463181c18d5d58c4b3c9",
  "93a8dc31c54c4c85aed08118c9c2ec78", "941539cbd8f5458085d1dc4e95835f24", "941f52334aee4efdb5a9f88a44903fd2", "9452e01bb91d4dd2b84176e170919182",
  "94a7ff0bcf534a88ab0ecc987cbdb7e7", "94ccc22293454708960a5b40ff99654e", "94ddcab394db4c9fb73afbc91d15d280", "94f59130995c47c29a7c00f1ccd77ffd",
  "9527e72f5aa1481d9fa40dd2a8af6652", "95c2246e0cfc40d084d8d0fa7712fe42", "95da30536f6646c09ca2ece7c61a73bd", "96179b088e6e4ea3a8b8b2b118c9af36",
  "96495a91d9e143699abd655d6570f56e", "9655907e92f445bea7514d1227e99dd5", "97668bcddd504f60bbe1e04f5d62d10f", "976e725cfe3f44ecbcf1a9d7f120fa2c",
  "9849d2d71a254666b9c53524a67806c1", "98ecd5e3d9274c1cb26cd6f30b323de8", "9975b2a55c104519a1e0166a8a2772fd", "9a3529d579c843d5b6a1cf60fbb52285",
  "9a90036cca504368924541aa6f4390f1", "9ad110a785d344178d45bf5302b7500c", "9b214ce2af8c433bad764ffb3a5a1f04", "9b36c671362b49af8dd837342ffca8ad",
  "9bab5b8f9dbc49569ad8a9d1be6b3a1b", "9c794f72a02a4ec3a6c95b4a488d15eb", "9d10ed45d8eb402cbd450eba0869fc07", "9d9c662fc2ae4ef8bef3c0768b6747cd",
  "9dd13351c6c6412d82b7bfdeab5ac90b", "9df50e2b4dcf42108f5e57a45541501d", "9ef139cd7961484da0af66566e440171", "9f5c8ac54fb140a688f04f72d2188ff7",
  "9ff0558eece2463dbaf51a4b6474a7ff", "a0bea203001a4a64bd8c073e7c653f51", "a108e71537e84ef8b450836a34319e32", "a13d81fdbe2d4643ab53b29003a9ca3d",
  "a27f3ef232684589983beff7b5da3428", "a2b1e746ec8247c7b19f49c67d05804b", "a2ec11c89efc4c489385777b23730307", "a307b72ad3fd490ebfeaea783fc61406",
  "a3080dd4e7d647729b845c293baf6c80", "a30f9450d2f44e61b8a19af406bc9fd3", "a364fd606f744853a519c2cbe9873194", "a391d2a7f9ee4c29a7a7e752f55c014e",
  "a4152dfffc02416f9c83943389c4e6e6", "a41f0f3508904053b2722f550dbd2014", "a43ab9fc81f04955839ac120321a5245", "a463705920b24c71888ee0d8ac9decfd",
  "a475243f6e024d03b98649aeafdcac33", "a47a6dca638845599ee209e2a38b748f", "a49f8c04d8b24c048ffba8e8755696a3", "a4c1a5f2cfbc44ad912eb4d6bcaf017c",
  "a5c2aeae26e84672a5fcf55466f8be33", "a691b1e8a3374b4cb708f372cf154b67", "a6fe85d62ed84c1399e186bc74df08e5", "a8a37f246df84c46bba897083b51cd6e",
  "a8c0a613c6da494183bbdf559fdf1ebf", "a8fa32f263894dc7ac431f8f4f199025", "a9285c459cc8496e9350c4b2842b43a7", "a963c7b5c78d46759ec472bc57912696",
  "a9fb96915cc74a7894a87fb5fa4ee43f", "aa0c9cd7e5d742b1a8e9ef63322c78a4", "ab4db4a9950e42bd8fef6d775d1cb861", "ac70d1f52b6b4ff6b625b4f25d253a8e",
  "acd5bc5cb73d4ee792ee15a7881d47a5", "ad101fb091db42dc8ba1a31bfd6cd8ca", "ad1be68069b543049de48d1586ffca44", "ad857cb5ea044eacae3f28280d3d13fc",
  "adc2d25feffe435ca2f9fa8c08e21c72", "adec57cae70a41a6bf4626b0a9a1f47b", "ae209bd0cccb4fa98de10c13c3b80473", "ae2b340bdf3b45c8be4a136eac093f25",
  "ae5e273542eb4db6b20f2152d434ef66", "ae6e7c4468b9478f948ab69de9e773f6", "ae72049363604617b673d40a4e9fafbe", "af8d8be6016146539db518dc65041ce8",
  "b0b18cbc033146d6902f59c83ab7d999", "b0e81d0ba90742f38001e7f3f5e59daf", "b1c865d1e9014e8786dff0b1679b14cf", "b25a75fdba2f4243821082fb46f3e9ad",
  "b26b82263e3147e28d5274c36e199bcf", "b2ff4695cdb944cbb6b631fc2cd5c994", "b38bee01d1b74484b2de645abf9ba03e", "b3d5af18d78449e38772e5322a255094",
  "b432575ea70046399bcedf9e9fbcf0f5", "b48ec673017c4fc29aaaeffc94a9f3f2", "b5ddf03a82e34fb6aa5e56c890fbd1fc", "b6112c27a85c4be3ba95346a31f0f359",
  "b62378a12a79415fa999e43fd0e03bb8", "b6c59682ee4943ee93be446f6f9e783f", "b6f82b90c04c42edab9bf3a1aea19a9e", "b700d4e9e6e0427d8c9de73261764962",
  "b74393614dc049b0a9d1d4d6609f3ad1", "b849e1dacbdf443ab7da23161d0ed4fd", "b90b632e12964c15b7921f3ffcd163f2", "b9e42c08721745dbaf82032820512e28",
  "ba13f62728c145d590cfcebb4dfed46f", "ba387b4ece1b4336a214b0cc94e3c57d", "ba4a2cbf7a43456c94511e9c5da63c32", "ba67f9aa09bc4bacb7b2634d7ee45513",
  "bb2b4d936aca43f08bf58d9319dc5bb6", "bb6ef01741c949b083f52b768e9a44fa", "bbbb71ef5cff49bf9b55282d51bf3af0", "bc0b5a9bd731421b8c8c2e844b1dbaec",
  "bd9d9b84b23a47269ed97d545fc3fa96", "be0733901c314127be67f605aee4fd0a", "beb7d72fe98747038f1731f571fa47e5", "bf322d9e43b84a97a12c1d319c281230",
  "bf95a69034b841bdbc979bd80c394602", "bfafa922c7904865bfd0c8640a165e20", "c0864391bbd640c39bef2f7e8c487a49", "c12efac6afa3489cae83b91fb4011c2f",
  "c1367ebbb2d24a7e9c991e0965312e8f", "c14b043bdf41472fb304b540e7bc417e", "c18d4f80691f4413875b74b124bac537", "c1968d1ec8b9446dbf2d2ab850270b3b",
  "c209d0173d6045ebbe22c1e9a0ca0452", "c244246c62bb4cd993412fa42b183f83", "c2deca47e8274994beeb9148c7d9f272", "c3187d48810342c99af6ef2b32f53538",
  "c34e6125fb394e8c913dcdc91bab3add", "c39515cf8fec4b54b2f3dc77464128f2", "c3ae6882a0de4066b15973920fb47ec9", "c3f76a1d36694623823ceafc9593b883",
  "c45c75a77e9f4739a71ab17661adeb22", "c4fec3fbccad4c358fd8e0dd4408d267", "c58ca1cc79ac49f4bd096dbc61ef58d8", "c59a39d67c8748aa9a3d35172b0269be",
  "c5cf823ed79d4dce80ac66e19a50d380", "c5dde48d115744e3a392d66eca69e0e2", "c63036435b734cddad21d4ea61086b8c", "c67e4b87c74b4c41ad2b5c0ea8083790",
  "c704509688934a4cb56e6d5e31466e2f", "c755cfbdeea0455f8f1123eb23760f3f", "c7c09246a7594e4fb1afb33ad4c8fe2a", "c89ad2fa90454da2bae9a57daa90b1a9",
  "c8a3662c0f71498cbdcbbdffa1b2deb9", "c905016ec011436e8cc6ccb653a28599", "ca605b2e6a9b410891c92df49bcb75e9", "cac512961f6a49a3a5eea11e52323c59",
  "cb054a4f46644fc89d95221e7014d1bc", "cb21b1bc802546b6aefe6c08177723b8", "cb7afb8dfeb44b2d95e3bfdab709d4cb", "ccddb8fc92e3488d9c9e176411a21d63",
  "cd0bb3cb1f744e01b3ddfb62a0ee5156", "cd19b136889e40f2bcad8d8e0978d3ba", "cd9325fb61d340d0a395a2655ff0fa8c", "cdcb4f8ed24a48f28b93007b0fc95c06",
  "cdf8d86b6d9543aa92d77fed02fa681f", "ce39bbbf91514a3ba97543fd6a3ac790", "cf24215899274e31a3589cf4a5fe6257", "cf8451fc99194251a4f413d0f7c55211",
  "cf8c74a05bea45cda97b5ca2e9abf032", "d03c0b7065334c909392bacfd98801e8", "d07ced1b318b4fe5ad944c7f694ea745", "d0cc981fe030489bb4129db15f8b1714",
  "d0e48287c71048a9ba04aecb4c1fdecd", "d1369a7cccfd4ca2ae0ae9d6093cdaad", "d1829adb99864fdeabccccb28a57b51f", "d1cc84687e994d4391c66021a196da99",
  "d1e4d8acf01445a88d667f17c5518c66", "d29be49ab8734b85b6a607b25a10016c", "d32a970194e94c4fa664d596af114aea", "d3302261451e4f229d561e35b4a646d1",
  "d352f521d610452c958730e2aae4911b", "d3a6572c03f3457b843673b0fddbf4ed", "d3c768bca9a941b4b66ed0f1b9128837", "d41c20fe3a604622ba6160d4692461e9",
  "d47ccc0f1ea44e4eaca3379cc5477668", "d47d1a63e6ba4ed39b1c7fd9af781e6c", "d48e80c727a6431eb945e8ce08d4ce06", "d4cff431a6ae416aa0ba753c3596fff1",
  "d4dd7b9935e44eb0a76fe0cb45a01ae6", "d51eb6b7c1474d01a54b8c692948e22b", "d553f0a810a649f7a0295f68fe288d5f", "d5c97fe23afc4286b2b35a9292f03cb0",
  "d5e1f7a0016c4d0e857ebb7ff6fd299f", "d5ecdfe0e3964ed7803f130aa596d0e8", "d610b6497e014c66ba385bb10c11981c", "d674eee4d77441e680e302de2b83c5b9",
  "d691b951088a4af5ad125550734d9991", "d6e33013ce984e06aaa2d525e5c8d29d", "d738c67e41a548cd8c0eaf8563063d06", "d7809da0e1ee4a06b0c42dca15ae6643",
  "d85a795b5eb34189bcf6fdd090aafedb", "d8d49ef859924284a63be64a75cfd8b0", "d8e9385705724c7284e9f0c1511014fb", "d8eec60dcbf0449c8da22f879a57ea46",
  "d92d3acb2a50406ab1e84903c9bb08f3", "d93be64e413d4af983df839f55f76bba", "d9c4e1eb0f0449469686a8d25c3ff992", "dc0c209ba955490e9ff6ecf2332201c3",
  "dc591426969c44e3ae3a94886ce4e72c", "dc809c763ac34123b3eca98546af435c", "dcb9409dc22c416f9cc466dea0508d51", "dcc9a608de374952aa0e6adbc704cd16",
  "dcf5abe0285846d48d0a453f5c589aca", "dd06c7daf17b492c85f16c3fc9aae83b", "dd407b6076cb41ee81cd9a49e2f72b25", "dd67697651a44ccaa7cb4a4c5ab2b226",
  "ddaf2e6a4d4e4155b4ba151161286205", "ddcbe76d8b0841bf88b0dd6244c1f6b7", "ddf170b1ac4e4887b99d0b700d01ef32", "de18a6e405aa467c80b57bc0e461ded6",
  "de60b06b730d41f996adb20f7340e882", "dec331ec257c401c8fe234ea2cab792e", "defc20484d1e4f5da42cd529bf06e03e", "df32c182735a478b8abd6fcaa8cd2c68",
  "df858364fe1f4d588edab7a2511df54d", "df9630b7881b40a2955cfee6629ed35c", "dfc28582351d41a4ac489735868ad267", "e01de77d12214efcbe94567e09a0d08a",
  "e05d5a619c9143f6b716d44e05ce661b", "e0ca5b1cdf584ede90db448985e7543d", "e0f4edaf620e4ab4b7a37d5d8ea53af1", "e165cec1676a4db6ac7cc5c18352962d",
  "e1805fcb87a94b699044ce38bc0c6b40", "e23a384a68ea45a08c996b91b267b8f8", "e264b42898e749b081e3537087c6f851", "e2e7fa14a4b0455586388846de877787",
  "e33bbb6bf6c14c37b5351e4a1b119ab0", "e459f084625040b4a0d2525188ce6931", "e47dfe30a1544c3e905f704e2ba38748", "e555b3d383204f679c889053bfbb1937",
  "e5ffc363286142079d0efc17359d13c6", "e698d5e5e15441399f7063aa7ca74f6a", "e6ebf1821e6d42ba86290eb961b7e80e", "e896d3684d6c4bbfbe3d46d01849faa6",
  "e8eb340a1e4545f68fa1e3b9146f2246", "e93848422b5a4334817b405f493adc35", "e9679b6db72b4055b4449c59dd8588d8", "e9df1881ab204a07889ae0a2f328821c",
  "ea5426f5dff5468eabda42d62f9adcc3", "ea7996a365f34f3f9b923c77ed4adb64", "eaa381e7c9fd4451b77bfa80465a8e34", "eb804c00cea94a60a26d2ee13b68b90c",
  "ec48bc0e84cb452898a52d35157c3d8d", "ec7804e715584d7e879d0f3cd37e75f1", "ede74dd4dc1b4fc7a5af5366e6214ffd", "ee104a733085480fbbffd1a08ce3076b",
  "ee75cbaf8edb4004a1f0fc6353e48f22", "ee98a47992574118a5e7fad5c43025c0", "f087badaa2b843a2afce1e0e97c43633", "f0dc9a37dcc94ef5ad404e6795378a49",
  "f121d5b8e41a4f5bb282d37fadbb787e", "f12a976b260c478c825acaa7ec1fdaf0", "f156d5a595b046bebc81f0a5521ecbcb", "f168b7305364414aaa6766bce2915be6",
  "f25131aa816b49fdb959d602fdeed302", "f26e45fd9cc04109802d74e74a1e0b8f", "f2c8a786c1094653bc20b7c477a10b3a", "f308c20698604a5699d9e37b557d1c77",
  "f311782880544d6ab2c01943a0cc2a2b", "f3379887f2e04551aed5a9a1771b22b0", "f3a2a6f8f5ca4966be46ad947c8a1956", "f3c937bf3ff04fdc9cc7476952771c49",
  "f400c2c921a5485cb14a942279cee870", "f4602d9452a243a898d633da90df4a76", "f470bb5bfd204c3caf4a92a421d4b9f7", "f4f0e708faa14b85a5d243609678177c",
  "f531dcb671e9497b8e806ea389078d11", "f55c6c4b5db04b8d8c09bd86aa90f76b", "f5d229d4aa914100a19de98188729342", "f628573c1a1c481d8e81daa81d2415e3",
  "f6669a79f36d4d58a52e5c49b2f3e0bb", "f695e261102543648a3c5b72c33734e6", "f6aa2f435fcf476caa40f99cae5ce099", "f6ebb277a1e04f5188f3cd5c55ca06a8",
  "f6f6f191135b4c7ebf864402414d8205", "f835d2ba86ab47499f5bbe7d52ce083f", "f8527e8abc4847c2ab3b50c108952d90", "f8837eb6dc6543669990c0564cb0a78a",
  "f888dc5fa0a24f6fb811ca2a80d704e4", "f8a0f2c2ba5e41ff83ff189ae185be71", "f8acf642fce74447b8c55dbd33f2f237", "f8f736f27bc44ccfa815ce235eb9328e",
  "f95563a6319244eea19dde60d7ba9665", "fa2bd63f48e44ba98017359baf4a8d45", "fac00c0399e9496b80a84eac26ae9a10", "faf4c61e005243ccbb62e4a9b3f84ac2",
  "fb6f4749a69e48f8b822668aa5fca973", "fb9870ad7594437c9e37bf2f7a0ab2cc", "fce4d6d025ee4b10a1c7268c8ad6f21c", "fceb405381a5425dbda09b7884bd8c4c",
  "fd1f2c3a76044732bbbaa0f8c9c1e76d", "fe319e96aa98452c9527299f996cf875", "fe39ca811c5641aa91dc2dbb08d13208", "ff3fda093e8f445583a1f0a84b35cf20",
];

export const dashed = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const FORMAT_SQL = "coalesce(e.subtype, case when e.computation is not null then 'fill_in_blank' end)";

/** SQL: the row still fails the table — a format the topic does not allow
 *  (incl. unserved topics), or a number line in a topic with the G5
 *  condition (its text was judged in code when the list was built). */
export function stillViolatingSql(): string {
  const pairs = Object.keys(TOPIC_FORMATS)
    .filter(isServedTopic)
    .flatMap((id) => allowedFormats(id).map((f) => `(${q(id)}, ${q(f)})`));
  const conditioned = Object.keys(TOPIC_FORMATS).filter((id) => hasCondition(id, "number-line-needs-operation"));
  return `((e.topic_id, ${FORMAT_SQL}) not in (values ${pairs.join(", ")}) or (${FORMAT_SQL} = 'number_line_placement' and e.topic_id in (${conditioned.map(q).join(", ")})))`;
}

const idValues = () => CLEANUP_IDS.map((h) => `(${q(dashed(h))}::uuid)`).join(",\n  ");

/** One read-only SELECT: the value of every guard, now. Safe to run any time. */
export function precheckSql(): string {
  return `with ids(id) as (values
  ${idValues()})
select
  (select count(*) from ids)::int as ids_in_list,
  (select md5(string_agg(id::text, ',' order by id::text)) from ids) = ${q(IDS_FINGERPRINT)} as fingerprint_ok,
  (select count(*) from exercises e join ids using (id))::int as rows_in_bank,
  (select count(*) from exercises e join ids using (id) where ${stillViolatingSql()})::int as rows_still_violating,
  (select count(*) from exercise_attempts a join ids on ids.id = a.exercise_id)::int as attempts_that_would_cascade,
  (select count(*) from exercises)::int as bank_total;`;
}

export function cleanupSql(): string {
  return `-- Format cleanup, 2026-09-27. Guarded; any failed guard raises and rolls back everything.
begin;
create temp table cleanup_ids (id uuid primary key) on commit drop;
insert into cleanup_ids (id) values
  ${idValues()};
do $$
declare
  fp text; n_rows int; n_violating int; n_attempts int; n_total int; n_deleted int;
begin
  select md5(string_agg(id::text, ',' order by id::text)) into fp from cleanup_ids;
  if fp is distinct from ${q(IDS_FINGERPRINT)} then raise exception 'id list fingerprint % does not match the audited one', fp; end if;
  select count(*) into n_rows from exercises e join cleanup_ids using (id);
  if n_rows <> ${EXPECTED_ROWS} then raise exception 'expected ${EXPECTED_ROWS} bank rows, found %', n_rows; end if;
  select count(*) into n_violating from exercises e join cleanup_ids using (id) where ${stillViolatingSql()};
  if n_violating <> ${EXPECTED_ROWS} then raise exception 'only % of the rows still fail the allowed-format table', n_violating; end if;
  select count(*) into n_attempts from exercise_attempts a join cleanup_ids c on c.id = a.exercise_id;
  if n_attempts <> 0 then raise exception '% exercise_attempts rows reference these bank rows (ON DELETE CASCADE would erase them) - owner decision needed', n_attempts; end if;
  select count(*) into n_total from exercises;
  delete from exercises e using cleanup_ids c where e.id = c.id;
  get diagnostics n_deleted = row_count;
  if n_deleted <> ${EXPECTED_ROWS} then raise exception 'deleted % rows, expected ${EXPECTED_ROWS}', n_deleted; end if;
  raise notice 'format cleanup: bank % -> % rows (% deleted)', n_total, n_total - n_deleted, n_deleted;
end $$;
commit;`;
}

/** Read-only, for after it ran: every listed id with how many bank rows it still has (expect 0 each), and the totals. */
export function readbackSql(): string {
  return `with ids(id) as (values
  ${idValues()})
select
  (select count(*) from ids)::int as ids_in_list,
  (select count(*) from ids where exists (select 1 from exercises e where e.id = ids.id))::int as ids_still_in_bank,
  (select count(*) from exercises)::int as bank_total,
  (select json_agg(json_build_object('id', ids.id, 'rows_remaining', (select count(*) from exercises e where e.id = ids.id)) order by ids.id) from ids) as per_row;`;
}

if (process.argv[1]?.endsWith("format-cleanup.ts")) {
  const flag = process.argv[2];
  if (flag === "--precheck") console.log(precheckSql());
  else if (flag === "--sql") console.log(cleanupSql());
  else if (flag === "--readback") console.log(readbackSql());
  else {
    console.error("usage: --precheck | --sql | --readback");
    process.exit(1);
  }
}

// teams.js - clubs and national teams for FC Soccer Bros
// Each team: id, name, short, c1 (primary), c2 (secondary), style (solid|stripes|sash|hoops), league
const CLUBS = [
  // Premier League
  { id: 'ARS', name: 'Arsenal', c1: '#e41b23', c2: '#ffffff', style: 'solid', league: 'Premier League' },
  { id: 'MCI', name: 'Man City', c1: '#6cabdd', c2: '#ffffff', style: 'solid', league: 'Premier League' },
  { id: 'LIV', name: 'Liverpool', c1: '#c8102e', c2: '#f6eb61', style: 'solid', league: 'Premier League' },
  { id: 'CHE', name: 'Chelsea', c1: '#034694', c2: '#ffffff', style: 'solid', league: 'Premier League' },
  { id: 'MUN', name: 'Man Utd', c1: '#da291c', c2: '#fbe122', style: 'solid', league: 'Premier League' },
  { id: 'TOT', name: 'Spurs', c1: '#ffffff', c2: '#132257', style: 'solid', league: 'Premier League' },
  { id: 'NEW', name: 'Newcastle', c1: '#222222', c2: '#ffffff', style: 'stripes', league: 'Premier League' },
  { id: 'AVL', name: 'Aston Villa', c1: '#670e36', c2: '#95bfe5', style: 'solid', league: 'Premier League' },
  { id: 'BHA', name: 'Brighton', c1: '#0057b8', c2: '#ffffff', style: 'stripes', league: 'Premier League' },
  { id: 'WHU', name: 'West Ham', c1: '#7a263a', c2: '#1bb1e7', style: 'solid', league: 'Premier League' },
  // La Liga
  { id: 'RMA', name: 'Real Madrid', c1: '#ffffff', c2: '#febe10', style: 'solid', league: 'La Liga' },
  { id: 'BAR', name: 'FC Barcelona', c1: '#a50044', c2: '#004d98', style: 'stripes', league: 'La Liga' },
  { id: 'ATM', name: 'Atlético Madrid', c1: '#cb3524', c2: '#ffffff', style: 'stripes', league: 'La Liga' },
  { id: 'ATH', name: 'Athletic Bilbao', c1: '#ee2523', c2: '#ffffff', style: 'stripes', league: 'La Liga' },
  { id: 'RSO', name: 'Real Sociedad', c1: '#0067b1', c2: '#ffffff', style: 'stripes', league: 'La Liga' },
  { id: 'VIL', name: 'Villarreal', c1: '#fbe122', c2: '#005187', style: 'solid', league: 'La Liga' },
  // Bundesliga
  { id: 'BAY', name: 'Bayern Munich', c1: '#dc052d', c2: '#ffffff', style: 'solid', league: 'Bundesliga' },
  { id: 'BVB', name: 'Dortmund', c1: '#fde100', c2: '#111111', style: 'solid', league: 'Bundesliga' },
  { id: 'LEV', name: 'Leverkusen', c1: '#e32221', c2: '#111111', style: 'solid', league: 'Bundesliga' },
  { id: 'RBL', name: 'RB Leipzig', c1: '#ffffff', c2: '#dd0741', style: 'solid', league: 'Bundesliga' },
  { id: 'SGE', name: 'Frankfurt', c1: '#e1000f', c2: '#111111', style: 'solid', league: 'Bundesliga' },
  // Serie A
  { id: 'INT', name: 'Inter Milan', c1: '#0068a8', c2: '#111111', style: 'stripes', league: 'Serie A' },
  { id: 'MIL', name: 'AC Milan', c1: '#fb090b', c2: '#111111', style: 'stripes', league: 'Serie A' },
  { id: 'JUV', name: 'Juventus', c1: '#ffffff', c2: '#111111', style: 'stripes', league: 'Serie A' },
  { id: 'NAP', name: 'Napoli', c1: '#12a0d7', c2: '#ffffff', style: 'solid', league: 'Serie A' },
  { id: 'ROM', name: 'AS Roma', c1: '#8e1f2f', c2: '#f0bc42', style: 'solid', league: 'Serie A' },
  { id: 'ATA', name: 'Atalanta', c1: '#1e71b8', c2: '#111111', style: 'stripes', league: 'Serie A' },
  // Ligue 1 & Rest of World
  { id: 'PSG', name: 'PSG', c1: '#004170', c2: '#da291c', style: 'sash', league: 'Ligue 1 & World' },
  { id: 'MON', name: 'Monaco', c1: '#e51b22', c2: '#ffffff', style: 'sash', league: 'Ligue 1 & World' },
  { id: 'OM', name: 'Marseille', c1: '#ffffff', c2: '#2faee0', style: 'solid', league: 'Ligue 1 & World' },
  { id: 'MIA', name: 'Inter Miami', c1: '#f7b5cd', c2: '#231f20', style: 'solid', league: 'Ligue 1 & World' },
  { id: 'HIL', name: 'Al-Hilal', c1: '#005cab', c2: '#ffffff', style: 'solid', league: 'Ligue 1 & World' },
  { id: 'NAS', name: 'Al-Nassr', c1: '#fcd116', c2: '#00338d', style: 'solid', league: 'Ligue 1 & World' },
  { id: 'BEN', name: 'Benfica', c1: '#e30613', c2: '#ffffff', style: 'solid', league: 'Ligue 1 & World' },
  { id: 'SCP', name: 'Sporting CP', c1: '#00855d', c2: '#ffffff', style: 'hoops', league: 'Ligue 1 & World' },
  { id: 'AJA', name: 'Ajax', c1: '#ffffff', c2: '#d2122e', style: 'sash', league: 'Ligue 1 & World' },
  { id: 'FLA', name: 'Flamengo', c1: '#c52613', c2: '#111111', style: 'hoops', league: 'Ligue 1 & World' },
  { id: 'SEV', name: 'Sevilla', c1: '#ffffff', c2: '#d4202a', style: 'solid', league: 'La Liga' },
];

// All 48 national teams for the expanded World Cup
const NATIONS = [
  { id: 'ARG', name: 'Argentina', c1: '#75aadb', c2: '#ffffff', style: 'stripes', flag: '🇦🇷' },
  { id: 'FRA', name: 'France', c1: '#1c3c8c', c2: '#ffffff', style: 'solid', flag: '🇫🇷' },
  { id: 'ESP', name: 'Spain', c1: '#c60b1e', c2: '#f1bf00', style: 'solid', flag: '🇪🇸' },
  { id: 'ENG', name: 'England', c1: '#ffffff', c2: '#1c2c5b', style: 'solid', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 'BRA', name: 'Brazil', c1: '#fedf00', c2: '#009c3b', style: 'solid', flag: '🇧🇷' },
  { id: 'POR', name: 'Portugal', c1: '#c8102e', c2: '#006600', style: 'solid', flag: '🇵🇹' },
  { id: 'GER', name: 'Germany', c1: '#ffffff', c2: '#111111', style: 'solid', flag: '🇩🇪' },
  { id: 'NED', name: 'Netherlands', c1: '#f36c21', c2: '#ffffff', style: 'solid', flag: '🇳🇱' },
  { id: 'BEL', name: 'Belgium', c1: '#c8102e', c2: '#fdda24', style: 'solid', flag: '🇧🇪' },
  { id: 'ITA', name: 'Italy', c1: '#0066b2', c2: '#ffffff', style: 'solid', flag: '🇮🇹' },
  { id: 'CRO', name: 'Croatia', c1: '#ffffff', c2: '#e4002b', style: 'checks', flag: '🇭🇷' },
  { id: 'USA', name: 'USA', c1: '#ffffff', c2: '#1a2c5b', style: 'sash', flag: '🇺🇸' },
  { id: 'MEX', name: 'Mexico', c1: '#006847', c2: '#ffffff', style: 'solid', flag: '🇲🇽' },
  { id: 'CAN', name: 'Canada', c1: '#d52b1e', c2: '#ffffff', style: 'solid', flag: '🇨🇦' },
  { id: 'URU', name: 'Uruguay', c1: '#7ab2e0', c2: '#111111', style: 'solid', flag: '🇺🇾' },
  { id: 'COL', name: 'Colombia', c1: '#fcd116', c2: '#003893', style: 'solid', flag: '🇨🇴' },
  { id: 'NOR', name: 'Norway', c1: '#ba0c2f', c2: '#00205b', style: 'solid', flag: '🇳🇴' },
  { id: 'JPN', name: 'Japan', c1: '#1b3a8c', c2: '#ffffff', style: 'solid', flag: '🇯🇵' },
  { id: 'KOR', name: 'South Korea', c1: '#cd2e3a', c2: '#ffffff', style: 'solid', flag: '🇰🇷' },
  { id: 'MAR', name: 'Morocco', c1: '#c1272d', c2: '#006233', style: 'solid', flag: '🇲🇦' },
  { id: 'SEN', name: 'Senegal', c1: '#ffffff', c2: '#00853f', style: 'solid', flag: '🇸🇳' },
  { id: 'SUI', name: 'Switzerland', c1: '#d52b1e', c2: '#ffffff', style: 'solid', flag: '🇨🇭' },
  { id: 'DEN', name: 'Denmark', c1: '#c60c30', c2: '#ffffff', style: 'solid', flag: '🇩🇰' },
  { id: 'AUT', name: 'Austria', c1: '#ed2939', c2: '#ffffff', style: 'solid', flag: '🇦🇹' },
  { id: 'SWE', name: 'Sweden', c1: '#fecc00', c2: '#006aa7', style: 'solid', flag: '🇸🇪' },
  { id: 'POL', name: 'Poland', c1: '#ffffff', c2: '#dc143c', style: 'solid', flag: '🇵🇱' },
  { id: 'SRB', name: 'Serbia', c1: '#c6363c', c2: '#0c4076', style: 'solid', flag: '🇷🇸' },
  { id: 'TUR', name: 'Türkiye', c1: '#e30a17', c2: '#ffffff', style: 'solid', flag: '🇹🇷' },
  { id: 'UKR', name: 'Ukraine', c1: '#ffd500', c2: '#005bbb', style: 'solid', flag: '🇺🇦' },
  { id: 'SCO', name: 'Scotland', c1: '#0b2a6b', c2: '#ffffff', style: 'solid', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  { id: 'WAL', name: 'Wales', c1: '#c8102e', c2: '#ffffff', style: 'solid', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  { id: 'ECU', name: 'Ecuador', c1: '#ffd100', c2: '#034ea2', style: 'solid', flag: '🇪🇨' },
  { id: 'PAR', name: 'Paraguay', c1: '#d52b1e', c2: '#ffffff', style: 'stripes', flag: '🇵🇾' },
  { id: 'AUS', name: 'Australia', c1: '#ffcd00', c2: '#00843d', style: 'solid', flag: '🇦🇺' },
  { id: 'IRN', name: 'Iran', c1: '#ffffff', c2: '#239f40', style: 'solid', flag: '🇮🇷' },
  { id: 'KSA', name: 'Saudi Arabia', c1: '#006c35', c2: '#ffffff', style: 'solid', flag: '🇸🇦' },
  { id: 'QAT', name: 'Qatar', c1: '#8a1538', c2: '#ffffff', style: 'solid', flag: '🇶🇦' },
  { id: 'EGY', name: 'Egypt', c1: '#ce1126', c2: '#ffffff', style: 'solid', flag: '🇪🇬' },
  { id: 'ALG', name: 'Algeria', c1: '#ffffff', c2: '#006233', style: 'solid', flag: '🇩🇿' },
  { id: 'TUN', name: 'Tunisia', c1: '#e70013', c2: '#ffffff', style: 'solid', flag: '🇹🇳' },
  { id: 'CIV', name: 'Ivory Coast', c1: '#f77f00', c2: '#009e60', style: 'solid', flag: '🇨🇮' },
  { id: 'GHA', name: 'Ghana', c1: '#ffffff', c2: '#006b3f', style: 'solid', flag: '🇬🇭' },
  { id: 'NGA', name: 'Nigeria', c1: '#008751', c2: '#ffffff', style: 'stripes', flag: '🇳🇬' },
  { id: 'CMR', name: 'Cameroon', c1: '#007a5e', c2: '#fcd116', style: 'solid', flag: '🇨🇲' },
  { id: 'CRC', name: 'Costa Rica', c1: '#ce1126', c2: '#002b7f', style: 'solid', flag: '🇨🇷' },
  { id: 'PAN', name: 'Panama', c1: '#d21034', c2: '#005293', style: 'solid', flag: '🇵🇦' },
  { id: 'NZL', name: 'New Zealand', c1: '#ffffff', c2: '#111111', style: 'solid', flag: '🇳🇿' },
  { id: 'GEO', name: 'Georgia', c1: '#ffffff', c2: '#e8112d', style: 'solid', flag: '🇬🇪' },
];

const TEAMS = {};
CLUBS.forEach(c => { c.kind = 'club'; TEAMS[c.id] = c; });
NATIONS.forEach(n => { n.kind = 'nation'; TEAMS[n.id] = n; });

const LEAGUES = ['Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1 & World'];

// Nation IDs by name for the player database
const NATION_BY_NAME = {};
NATIONS.forEach(n => { NATION_BY_NAME[n.name] = n.id; });
NATION_BY_NAME['Ivory Coast'] = 'CIV';

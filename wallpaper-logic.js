/**
 * Wallpaper Calculation Logic Engine - v3.2
 * ინდუსტრიული სტანდარტი: 80სმ-იანი რეზერვი ასაწყობი შპალერისთვის
 */
const WallpaperLogic = {
    // 1. კედლის ფართობის გამოთვლა
    calcWallArea: function(width, height) {
        return (parseFloat(width) || 0) * (parseFloat(height) || 0);
    },

    // 2. ზოლის ეფექტური სიმაღლის გამოთვლა
    // ლოგიკა: თუ ნახატი ასაწყობია (repeat > 0), ვამატებთ 80სმ-ს, თუ არა - 5სმ-ს.
    calcEffectiveStripHeight: function(wallHeight, patternRepeat) {
        const h = parseFloat(wallHeight) || 0;
        const r = parseFloat(patternRepeat) || 0;
        
        if (h <= 0) return 0;

        // შენი მოთხოვნილი ლოგიკა: ასაწყობზე 80სმ რეზერვი
        const safetyMargin = (r > 0) ? 0.80 : 0;
        
        return h + safetyMargin;
    },

    // 3. იმის დათვლა, თუ რამდენი ზოლი ამოვა ერთი რულონიდან
    calcStripsPerRoll: function(rollLength, effectiveHeight) {
        const len = parseFloat(rollLength) || 0;
        const effH = parseFloat(effectiveHeight) || 0;
        
        if (effH <= 0) return 0;
        
        // ვიყენებთ Math.floor-ს, რადგან ნახევარ ზოლს კედელზე ვერ გავაკრავთ
        return Math.floor(len / effH);
    },

    // 4. მთავარი აგრეგატორი ფუნქცია, რომელსაც app.js იძახებს
    calcWallpaperAll: function(params) {
        // ცვლადების ამოღება (ზუსტად იმ სახელებით, რასაც app.js აგზავნის)
        const wallWidth = parseFloat(params.wallWidthM) || 0;
        const wallHeight = parseFloat(params.wallHeightM) || 0;
        const rollWidth = parseFloat(params.rollWidthM) || 0;
        const rollLength = parseFloat(params.rollLengthM) || 0;
        const patternRepeat = parseFloat(params.patternRepeatCm) || 0;

        // ა) კედლის ფართობი
        const wallArea = this.calcWallArea(wallWidth, wallHeight);

        // ბ) ზოლების ჯამური რაოდენობა კედლისთვის
        const totalStrips = rollWidth > 0 ? Math.ceil(wallWidth / rollWidth) : 0;
        
        // გ) ერთი ზოლის სიგრძე რეზერვით
        const effectiveStripHeight = this.calcEffectiveStripHeight(wallHeight, patternRepeat);

        // დ) ზოლები ერთ რულონში
        const stripsPerRoll = this.calcStripsPerRoll(rollLength, effectiveStripHeight);
        
        // ე) საჭირო რულონების რაოდენობა (მრგვალდება ყოველთვის ზემოთ)
        const totalRolls = stripsPerRoll > 0 ? Math.ceil(totalStrips / stripsPerRoll) : 0;
        
        // ვ) ჯამური შესყიდული ფართობი (app.js-ისთვის კრიტიკული ველი)
        const totalPurchasedArea = totalRolls * (rollWidth * rollLength);

        // ზ) ნარჩენის პროცენტი
        const wastePercent = totalPurchasedArea > 0 
            ? ((totalPurchasedArea - wallArea) / totalPurchasedArea) * 100 
            : 0;
        // 1. ჯერ ვთვლით ფასს
            const totalPrice = totalRolls * (params.rollPrice || 0); 

        return {
            wallArea: wallArea,
            totalStrips: totalStrips,
            stripsPerRoll: stripsPerRoll,
            totalRolls: totalRolls,
            effectiveStripHeight: effectiveStripHeight,
            totalPurchasedArea: totalPurchasedArea,
            wastePercent: wastePercent,
            totalPrice: totalPrice
        };
    }
};

// გლობალურ ობიექტზე მიბმა, რომ სხვა ფაილებმა დაინახონ
window.WallpaperLogic = WallpaperLogic;
// src/components/EquipmentItem.jsx
import React from 'react';

const EquipmentItem = ({ equipment, isSelected, onToggle }) => (
    <div onClick={() => onToggle(equipment)} className={`p-3 rounded-xl cursor-pointer border-2 transition-all ${isSelected ? 'border-orange-500 bg-orange-900' : 'border-gray-700 bg-gray-700 hover:border-orange-400'}`}>
        <div className="flex items-center space-x-3">
            <div className="text-2xl">{equipment.icon}</div>
            <div>
                <h4 className="font-semibold text-white">{equipment.name}</h4>
                <p className="text-sm text-gray-400">{equipment.type}</p>
            </div>
            {isSelected && <div className="ml-auto w-6 h-6 bg-orange-500 rounded-full flex items-center justify-center text-white">✓</div>}
        </div>
    </div>
);

export default EquipmentItem;

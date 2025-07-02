const PaymentOption = ({ value, label, selected, onSelect }) => (
    <div onClick={() => onSelect(value)} className={`p-4 rounded-xl cursor-pointer border-2 transition-all ${selected === value ? 'border-orange-500 bg-orange-900' : 'border-gray-700 bg-gray-700 hover:border-orange-400'}`}>
        <label className="flex items-center space-x-3 cursor-pointer">
            <input type="radio" name="paymentMethod" value={value} checked={selected === value} onChange={() => onSelect(value)} className="form-radio h-5 w-5 text-orange-600 bg-gray-800 border-gray-600 focus:ring-orange-500" />
            <span className="font-medium text-white">{label}</span>
        </label>
    </div>
);
export default PaymentOption;